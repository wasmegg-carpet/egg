import { describe, expect, it } from 'vitest';
import type { TableHeader } from './table';
import { describeTableArtifacts, tableArtifacts } from './tableArtifacts';

const header = (over: Partial<TableHeader> = {}): TableHeader => ({
  version: 1,
  referenceWeek: 1799654400,
  cteBonus: 128.71,
  deliveryScore: 1,
  from: 120,
  to: 489,
  slots: 3,
  builtAt: '2026-10-21T04:22:52.116Z',
  ...over,
});

describe('tableArtifacts', () => {
  it("reads a Table Builder table's id sets", () => {
    const h = header({
      earnings: ['demeters-necklace-4-3', 'puzzle-cube-4-3', 'lunar-totem-4-3', 'tungsten-ankh-4-3'],
      delivery: ['quantum-metronome-3-2', 'interstellar-compass-4-0', 'gusset-2-2', 'lunar-totem-4-3'],
      stones: { 'tachyon-stone-4': 12, 'quantum-stone-4': 12 },
    });
    expect(tableArtifacts(h)).toEqual({
      earnings: ['T4L Demeters necklace', 'T4L Puzzle cube', 'T4L Lunar totem', 'T4L Tungsten ankh'],
      delivery: ['T3E Quantum metronome', 'T4C Interstellar compass', 'T2E Gusset', 'T4L Lunar totem'],
      stones: [
        { label: 'T4 Tachyon stone', count: 12 },
        { label: 'T4 Quantum stone', count: 12 },
      ],
    });
    expect(describeTableArtifacts(h)).toBe(
      'earnings T4L Demeters necklace, T4L Puzzle cube, T4L Lunar totem, T4L Tungsten ankh · ' +
        'delivery T3E Quantum metronome, T4C Interstellar compass, T2E Gusset, T4L Lunar totem · ' +
        '12× T4 Tachyon stone, 12× T4 Quantum stone'
    );
  });

  it("falls back to a gear stamp's labels", () => {
    const h = header({
      gear: {
        earnings: [{ artifact: 'T4L Demeters necklace', stones: ['T4 Lunar stone'] }],
        deliveryBare: [],
        deliveryFull: [{ artifact: 'T4L Quantum metronome', stones: [] }],
        research: {},
        epicResearch: {},
        colleggtibles: {},
      },
    });
    expect(tableArtifacts(h)).toEqual({
      earnings: ['T4L Demeters necklace'],
      delivery: ['T4L Quantum metronome'],
      stones: [],
    });
  });

  it("falls back to the maxed table's k3 delivery set", () => {
    const h = header({
      k3: { delivery: [{ artifactId: 'gusset-4-3' }, { artifactId: null }] },
    });
    expect(tableArtifacts(h).delivery).toEqual(['T4L Gusset']);
    expect(tableArtifacts(h).earnings).toEqual([]);
  });

  it('says nothing about a header that records no sets', () => {
    expect(tableArtifacts(header())).toEqual({ earnings: [], delivery: [], stones: [] });
    expect(describeTableArtifacts(header())).toBe('');
  });
});
