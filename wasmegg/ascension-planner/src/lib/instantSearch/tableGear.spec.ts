import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  colleggtibleEffects,
  gearChanges,
  gearTableName,
  gearTableNameV3,
  gearTableNames,
  legacyGearTableName,
  simEpicResearch,
  type TableGear,
} from './tableGear';

const slot = (artifact: string, ...stones: string[]) => ({ artifact, stones });

function stamp(): TableGear {
  return {
    earnings: [
      slot('T4L Demeters necklace', 'T4 Lunar stone', 'T4 Lunar stone', 'T4 Lunar stone'),
      slot('T4L Puzzle cube', 'T4 Lunar stone', 'T3 Lunar stone', 'T3 Lunar stone'),
      slot('T4L Tungsten ankh', 'T4 Lunar stone', 'T4 Lunar stone', 'T4 Lunar stone'),
      slot('T4L Lunar totem', 'T4 Lunar stone', 'T3 Lunar stone', 'T4 Lunar stone'),
    ],
    deliveryBare: [
      slot('T4L Interstellar compass', 'T4 Quantum stone', 'T4 Quantum stone'),
      slot('T4L Puzzle cube', 'T4 Quantum stone', 'T4 Quantum stone', 'T4 Quantum stone'),
    ],
    deliveryFull: [
      slot('T4L Gusset', 'T4 Tachyon stone', 'T4 Tachyon stone', 'T4 Tachyon stone'),
      slot('T4E Quantum metronome', 'T4 Tachyon stone', 'T4 Tachyon stone'),
    ],
    research: { comfy_nests: 50 },
    epicResearch: { epic_multiplier: 100 },
    colleggtibles: { wood: 3 },
  };
}

describe('gearChanges', () => {
  it('matches the same stamp', () => {
    expect(gearChanges(stamp(), stamp())).toEqual([]);
  });

  it('ignores the order the same artifacts are worn in', () => {
    const mine = stamp();
    const [necklace, cube, ankh, totem] = mine.earnings;
    mine.earnings = [ankh, necklace, cube, totem];
    mine.deliveryBare.reverse();
    mine.deliveryFull.reverse();
    expect(gearChanges(stamp(), mine)).toEqual([]);
  });

  it("ignores which artifact a stone is in, and the stones' order", () => {
    const mine = stamp();
    mine.earnings = [
      slot('T4L Demeters necklace', 'T3 Lunar stone', 'T3 Lunar stone', 'T3 Lunar stone'),
      slot('T4L Puzzle cube', 'T4 Lunar stone', 'T4 Lunar stone', 'T4 Lunar stone'),
      slot('T4L Lunar totem', 'T4 Lunar stone', 'T4 Lunar stone', 'T4 Lunar stone'),
      slot('T4L Tungsten ankh', 'T4 Lunar stone', 'T4 Lunar stone', 'T4 Lunar stone'),
    ];
    expect(gearChanges(stamp(), mine)).toEqual([]);

    const reordered = stamp();
    reordered.earnings[1] = slot('T4L Puzzle cube', 'T3 Lunar stone', 'T3 Lunar stone', 'T4 Lunar stone');
    expect(gearChanges(stamp(), reordered)).toEqual([]);
  });

  it('still sees a real change: another artifact, another stone, one fewer', () => {
    const swapped = stamp();
    swapped.earnings[3] = slot('T4L Lunar totem', 'T4 Lunar stone', 'T4 Lunar stone', 'T4 Lunar stone');
    expect(gearChanges(stamp(), swapped)).toEqual(['earnings set']);

    const otherArtifact = stamp();
    otherArtifact.earnings[2] = slot('T4E Tungsten ankh', 'T4 Lunar stone', 'T4 Lunar stone', 'T4 Lunar stone');
    expect(gearChanges(stamp(), otherArtifact)).toEqual(['earnings set']);

    const delivery = stamp();
    delivery.deliveryFull[1] = slot('T4L Quantum metronome', 'T4 Tachyon stone', 'T4 Tachyon stone');
    expect(gearChanges(stamp(), delivery)).toEqual(['delivery set']);

    const fewer = stamp();
    fewer.earnings.pop();
    expect(gearChanges(stamp(), fewer)).toEqual(['earnings set']);
  });

  it('still sees epic research and colleggtibles', () => {
    const mine = stamp();
    mine.epicResearch = { epic_multiplier: 99 };
    mine.colleggtibles = { wood: 2 };
    expect(gearChanges(stamp(), mine)).toEqual(['epic research', 'colleggtibles']);
  });
});

describe('gear table names', () => {
  it('the legacy name is unchanged: the stamp as worn, research left out', async () => {
    const { research: _r, ...gear } = stamp();
    void _r;
    const hex = createHash('sha256').update(JSON.stringify(gear)).digest('hex').slice(0, 24);
    expect(await legacyGearTableName(stamp())).toBe(`gear-${hex}.bin`);
  });

  it('the canonical name ignores slot order and which artifact a stone is in; the legacy one does not', async () => {
    const mine = stamp();
    const [necklace, cube, ankh, totem] = mine.earnings;
    mine.earnings = [ankh, totem, necklace, cube].map(s => ({ ...s, stones: [...s.stones].reverse() }));
    mine.deliveryFull.reverse();
    // The same nine T4 and three T3 lunar stones in another split.
    mine.earnings[0] = slot('T4L Tungsten ankh', 'T3 Lunar stone', 'T3 Lunar stone', 'T3 Lunar stone');
    mine.earnings[2] = slot('T4L Demeters necklace', 'T4 Lunar stone', 'T4 Lunar stone', 'T4 Lunar stone');
    mine.earnings[3] = slot('T4L Puzzle cube', 'T4 Lunar stone', 'T4 Lunar stone', 'T4 Lunar stone');
    mine.earnings[1] = slot('T4L Lunar totem', 'T4 Lunar stone', 'T4 Lunar stone', 'T4 Lunar stone');
    expect(gearChanges(stamp(), mine)).toEqual([]);
    expect(await gearTableName(mine)).toBe(await gearTableName(stamp()));
    expect(await legacyGearTableName(mine)).not.toBe(await legacyGearTableName(stamp()));
    // Key order in the research maps and the waiting research do not matter either.
    const keys = stamp();
    keys.epicResearch = { b_epic: 1, a_epic: 2 };
    const keys2 = stamp();
    keys2.epicResearch = { a_epic: 2, b_epic: 1 };
    keys2.research = { comfy_nests: 1 };
    expect(await gearTableName(keys)).toBe(await gearTableName(keys2));
  });

  it('the canonical name still changes with the gear, and never equals a legacy name', async () => {
    const other = stamp();
    other.earnings[2] = slot('T4E Tungsten ankh', 'T4 Lunar stone', 'T4 Lunar stone', 'T4 Lunar stone');
    expect(await gearTableName(other)).not.toBe(await gearTableName(stamp()));
    const moved = stamp();
    moved.deliveryFull[1].stones.push('T4 Tachyon stone');
    expect(await gearTableName(moved)).not.toBe(await gearTableName(stamp()));
    expect(await gearTableName(stamp())).toMatch(/^gear-[0-9a-f]{24}\.bin$/);
    expect(await gearTableName(stamp())).not.toBe(await legacyGearTableName(stamp()));
  });

  it('looks up v3 first, then the v2 canonical name, then legacy', async () => {
    expect(await gearTableNames(stamp())).toEqual([
      await gearTableNameV3(stamp()),
      await gearTableName(stamp()),
      await legacyGearTableName(stamp()),
    ]);
  });
});

describe('v3 names: only what the simulator reads', () => {
  const withUnread = () => {
    const s = stamp();
    s.epicResearch = { ...s.epicResearch, epic_silo_quality: 40, warp_shift: 16 };
    return s;
  };

  it('ignores epic research the planner never reads; v2 and legacy did not', async () => {
    expect(await gearTableNameV3(withUnread())).toBe(await gearTableNameV3(stamp()));
    expect(await gearTableName(withUnread())).not.toBe(await gearTableName(stamp()));
    expect(await legacyGearTableName(withUnread())).not.toBe(await legacyGearTableName(stamp()));
  });

  it('a missing modelled research counts as 0, so it matches a save that lists it at 0', async () => {
    const zero = stamp();
    zero.epicResearch = { ...zero.epicResearch, epic_clucking: 0 };
    expect(await gearTableNameV3(zero)).toBe(await gearTableNameV3(stamp()));
    expect(simEpicResearch(zero.epicResearch)).toEqual(simEpicResearch(stamp().epicResearch));
  });

  it('still changes with modelled epic research, colleggtible effects and gear', async () => {
    const er = stamp();
    er.epicResearch = { epic_multiplier: 99 };
    expect(await gearTableNameV3(er)).not.toBe(await gearTableNameV3(stamp()));
    const coll = stamp();
    coll.colleggtibles = { wood: 2 };
    expect(colleggtibleEffects(coll.colleggtibles)).not.toEqual(colleggtibleEffects(stamp().colleggtibles));
    expect(await gearTableNameV3(coll)).not.toBe(await gearTableNameV3(stamp()));
    const gear = stamp();
    gear.earnings[2] = slot('T4E Tungsten ankh', 'T4 Lunar stone', 'T4 Lunar stone', 'T4 Lunar stone');
    expect(await gearTableNameV3(gear)).not.toBe(await gearTableNameV3(stamp()));
  });

  it('colleggtibles count by effect: an egg not earned and an egg absent are the same', async () => {
    const absent = stamp();
    const listed = stamp();
    listed.colleggtibles = { ...listed.colleggtibles, not_a_real_egg: 3 };
    expect(await gearTableNameV3(listed)).toBe(await gearTableNameV3(absent));
  });

  it('never equals a v2 or legacy name', async () => {
    const v3 = await gearTableNameV3(stamp());
    expect(v3).toMatch(/^gear-[0-9a-f]{24}\.bin$/);
    expect(v3).not.toBe(await gearTableName(stamp()));
    expect(v3).not.toBe(await legacyGearTableName(stamp()));
  });

  it('gearChanges (own tables) ignores unread research too, and still sees modelled research', () => {
    expect(gearChanges(stamp(), withUnread())).toEqual([]);
    const mine = stamp();
    mine.epicResearch = { epic_multiplier: 99 };
    expect(gearChanges(stamp(), mine)).toEqual(['epic research']);
  });
});
