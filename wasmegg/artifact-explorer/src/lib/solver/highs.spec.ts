// Tests `highs.ts`, not the `highs` package: models are built in memory and the
// returned point is checked against the *in-memory* model rather than against the text.

import { describe, expect, it } from 'vitest';
import { INF, type MilpModel, type MilpSolve } from './types';
import { loadHighs } from './highs';

const solve: MilpSolve = await loadHighs();

interface Row {
  // column -> coefficient. Ordered pairs, not an object: integer-like object keys
  // enumerate in ascending numeric order, so no fixture could exercise an unsorted row.
  terms: [number, number][];
  lower: number;
  upper: number;
}

function model(
  columns: { lower: number; upper: number; integer?: boolean; objective?: number }[],
  rows: Row[]
): MilpModel {
  const offsets: number[] = [];
  const indices: number[] = [];
  const values: number[] = [];
  for (const row of rows) {
    offsets.push(indices.length);
    for (const [column, coefficient] of row.terms) {
      indices.push(column);
      values.push(coefficient);
    }
  }
  return {
    columnCount: columns.length,
    columnLower: Float64Array.from(columns.map(c => c.lower)),
    columnUpper: Float64Array.from(columns.map(c => c.upper)),
    columnIsInteger: Uint8Array.from(columns.map(c => (c.integer ? 1 : 0))),
    objective: Float64Array.from(columns.map(c => c.objective ?? 0)),
    rowCount: rows.length,
    rowLower: Float64Array.from(rows.map(r => r.lower)),
    rowUpper: Float64Array.from(rows.map(r => r.upper)),
    offsets: Int32Array.from(offsets),
    indices: Int32Array.from(indices),
    values: Float64Array.from(values),
  };
}

const TOL = 1e-6;

function expectSatisfies(m: MilpModel, x: Float64Array): void {
  for (let j = 0; j < m.columnCount; j++) {
    expect(x[j], `column ${j} lower bound`).toBeGreaterThanOrEqual(m.columnLower[j] - TOL);
    expect(x[j], `column ${j} upper bound`).toBeLessThanOrEqual(m.columnUpper[j] + TOL);
    if (m.columnIsInteger[j]) {
      expect(Math.abs(x[j] - Math.round(x[j])), `column ${j} integrality`).toBeLessThan(TOL);
    }
  }
  for (let r = 0; r < m.rowCount; r++) {
    const start = m.offsets[r];
    const end = r + 1 < m.rowCount ? m.offsets[r + 1] : m.indices.length;
    let activity = 0;
    for (let k = start; k < end; k++) activity += m.values[k] * x[m.indices[k]];
    const scale = Math.max(1, Math.abs(m.rowLower[r]), Math.abs(m.rowUpper[r]));
    expect(activity, `row ${r} lower bound`).toBeGreaterThanOrEqual(m.rowLower[r] - TOL * scale);
    expect(activity, `row ${r} upper bound`).toBeLessThanOrEqual(m.rowUpper[r] + TOL * scale);
  }
}

function objectiveOf(m: MilpModel, x: Float64Array): number {
  let total = 0;
  for (let j = 0; j < m.columnCount; j++) total += m.objective[j] * x[j];
  return total;
}

describe('the LP-format writer round-trips the model', () => {
  it('carries bounds, integrality and an upper-bounded row', () => {
    const m = model(
      [
        { lower: 0, upper: 3, integer: true, objective: 1 },
        { lower: 0, upper: 10, integer: true, objective: 1 },
      ],
      [
        {
          terms: [
            [0, 1],
            [1, 2],
          ],
          lower: -INF,
          upper: 4,
        },
      ]
    );
    const solution = solve(m, { maxNodes: 1000, relGap: 1e-9 });
    expect(solution.status).toBe('optimal');
    expectSatisfies(m, solution.columnValues);
    expect(solution.objective).toBeCloseTo(3, 6);
    expect(objectiveOf(m, solution.columnValues)).toBeCloseTo(solution.objective, 6);
  });

  it('carries equality rows, negative coefficients and a free column', () => {
    // The shape the real model uses for its score rows.
    const m = model(
      [
        { lower: 0, upper: 5, integer: true },
        { lower: 0, upper: 5, integer: true },
        { lower: -INF, upper: INF, objective: 1 },
      ],
      [
        {
          terms: [
            [2, 1],
            [0, -2],
            [1, -3],
          ],
          lower: 0,
          upper: 0,
        },
        {
          terms: [
            [0, 1],
            [1, 1],
          ],
          lower: -INF,
          upper: 4,
        },
        {
          terms: [
            [0, 1],
            [1, -1],
          ],
          lower: 0,
          upper: INF,
        },
      ]
    );
    const solution = solve(m, { maxNodes: 1000, relGap: 1e-9 });
    expect(solution.status).toBe('optimal');
    expectSatisfies(m, solution.columnValues);
    expect(solution.objective).toBeCloseTo(10, 6);
  });

  it('survives the coefficient range the cuts actually use', () => {
    // The coefficient range the real model spans: tangent slopes 1 to 1e7, slot rows
    // in raw seconds (~1e6), fuel costs (~1e-3).
    const m = model(
      [
        { lower: 0, upper: 100, integer: true },
        { lower: -INF, upper: 0, objective: 1 },
      ],
      [
        { terms: [[0, 1234.5678]], lower: -INF, upper: 2592000 },
        { terms: [[0, 0.001371742112482853]], lower: -INF, upper: 1 },
        {
          terms: [
            [1, 1],
            [0, -1e-7],
          ],
          lower: -INF,
          upper: -3.5e-6,
        },
        {
          terms: [
            [1, 1],
            [0, -1e7],
          ],
          lower: -INF,
          upper: 4.25,
        },
      ]
    );
    const solution = solve(m, { maxNodes: 1000, relGap: 1e-9 });
    expect(solution.status).toBe('optimal');
    expectSatisfies(m, solution.columnValues);
    expect(objectiveOf(m, solution.columnValues)).toBeCloseTo(solution.objective, 6);
  });

  it('reports infeasibility rather than a plausible-looking point', () => {
    const m = model(
      [{ lower: 2, upper: 5, integer: true, objective: 1 }],
      [{ terms: [[0, 1]], lower: -INF, upper: 1 }]
    );
    expect(solve(m, { maxNodes: 1000, relGap: 1e-9 }).status).toBe('infeasible');
  });
});
