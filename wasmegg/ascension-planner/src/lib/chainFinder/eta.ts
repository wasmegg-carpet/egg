/**
 * Time-remaining estimate for the Table Builder's build. Start TEs differ in cost by ~15x (low TEs
 * are slow, and the build runs high to low), so a plain cells-per-second average is far too
 * optimistic early on. Each cell is weighted by its start TE's relative cost instead, and the rate
 * of weighted work is measured over a recent window so a change of worker count shows up quickly.
 */

/**
 * Core-seconds per start TE on a maxed account (src/buildTable/NOTES.md, "Measured"), interpolated
 * linearly. Only the shape matters: the measured rate supplies the scale, so other delivery sets
 * and machines are fine as long as their costs vary with TE in roughly the same way.
 */
const TE_COST: [te: number, coreSeconds: number][] = [
  [120, 320],
  [180, 170],
  [189, 170],
  [190, 270], // tier-13 attempts begin
  [330, 150],
  [340, 140],
  [353, 105],
  [354, 65],
  [400, 45],
  [489, 20],
];

/** A start TE's relative cost (core-seconds for the whole TE, on the profile's machine). */
export function teCost(te: number): number {
  if (te <= TE_COST[0][0]) return TE_COST[0][1];
  for (let i = 1; i < TE_COST.length; i++) {
    const [t1, c1] = TE_COST[i];
    if (te <= t1) {
      const [t0, c0] = TE_COST[i - 1];
      return c0 + ((c1 - c0) * (te - t0)) / (t1 - t0);
    }
  }
  return TE_COST[TE_COST.length - 1][1];
}

/** How far back the rate looks: long enough to smooth out cell-to-cell noise, short enough to follow a resize. */
const WINDOW_MS = 5 * 60_000;
/** Below this much measured time the rate is too noisy to show. */
const MIN_WINDOW_MS = 20_000;

export class BuildEta {
  private readonly cellWeights: Map<number, number>;
  private readonly totalWork: number;
  private doneWork = 0;
  private samples: { t: number; work: number }[] = [];

  /** `cellsPerTE` cells for each start TE in `tes`. */
  constructor(tes: number[], cellsPerTE: number, t0: number) {
    this.cellWeights = new Map(tes.map(te => [te, teCost(te) / cellsPerTE]));
    this.totalWork = tes.reduce((sum, te) => sum + teCost(te), 0);
    this.samples.push({ t: t0, work: 0 });
  }

  /** A cell of start TE `te` finished at time `t`. */
  cellDone(te: number, t: number): void {
    this.doneWork += this.cellWeights.get(te) ?? 0;
    this.samples.push({ t, work: this.doneWork });
    // Keep one sample at or before the window start, so the window spans its full length.
    while (this.samples.length > 2 && this.samples[1].t <= t - WINDOW_MS) this.samples.shift();
  }

  /** Share of the build's estimated time that's done, 0-1. */
  get fractionDone(): number {
    return this.totalWork ? this.doneWork / this.totalWork : 0;
  }

  /** Estimated ms left at time `t`, or null until there's enough to go on. */
  remainingMs(t: number): number | null {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const span = t - first.t;
    const work = last.work - first.work;
    if (span < MIN_WINDOW_MS || work <= 0) return null;
    return ((this.totalWork - this.doneWork) * span) / work;
  }
}
