// The arena's 2x mission capacity event: every mission that launches inside a window starting at the plan's
// t = 0 brings home twice its drops, whenever it lands. Owned by the harness and never shared with
// `lib/mission-optimizer`, for the reason the sleep model is not: a variant rule used by both the planner and its
// judge would agree with itself no matter what it computed. Imports nothing. See ARENA.md, "The 2x capacity
// window".

export type ArenaCapacityVariant = 'normal' | 'event' | 'overhang';

// The fields a variant is built from. Generic so this file needs no import, not even a type one.
export interface CapacityVariantSource {
  id: string;
  actualTime: number;
  variant?: ArenaCapacityVariant;
  lastInSlot?: boolean;
  supplyVector: Map<string, number>;
  yieldVector: Map<string, number>;
  legendaryYieldVector: Map<string, number>;
}

function times2(vector: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, qty] of vector) out.set(key, qty * 2);
  return out;
}

// Splits every option by the capacity it can fly at, with `w` seconds of window left:
// - `normal`: as given, 1x, same `id`;
// - `event`: 2x every drop vector, id suffixed `::event`, only when `actualTime <= w`;
// - `overhang`: 2x every drop vector, id suffixed `::overhang`, always.
// Everything else (fuel, seconds, nights, cost) is the option's own. `w <= 0` returns `options` itself,
// untouched: no variant, no `variant` field, today's menu exactly.
export function capacityVariants<T extends CapacityVariantSource>(options: readonly T[], w: number): readonly T[] {
  if (!(w > 0)) return options;
  const out: T[] = [];
  for (const o of options) {
    const twice = {
      supplyVector: times2(o.supplyVector),
      yieldVector: times2(o.yieldVector),
      legendaryYieldVector: times2(o.legendaryYieldVector),
    };
    out.push({ ...o, variant: 'normal' });
    // A slot's-last-launch entry has no doubled copy (`lastVariants` below).
    if (o.lastInSlot) continue;
    if (o.actualTime <= w) out.push({ ...o, ...twice, id: `${o.id}::event`, variant: 'event' });
    out.push({ ...o, ...twice, id: `${o.id}::overhang`, variant: 'overhang' });
  }
  return out;
}

// Whether a launch of this option flies at 2x.
export function isDoubled(option: { variant?: string }): boolean {
  return option.variant === 'event' || option.variant === 'overhang';
}

// The effort level as this harness states it (ARENA.md, "The effort level"): it spaces a slot's launches, each at
// least the period after the one before, and nothing else, so a slot's last launch only has to land by the horizon.
// The menu's `actualTime` is the flight floored to the period; for each entry the floor lengthens, this adds the same
// flight once more at its `rawTime`, marked `lastInSlot` and id suffixed `~last`, which may fly only as its slot's
// last launch. It gets no doubled copy: such a launch inside a 2x window counts at 1x.
export function lastVariants<T extends { id: string; actualTime: number; rawTime: number }>(
  options: readonly T[]
): (T & { lastInSlot: true })[] {
  const out: (T & { lastInSlot: true })[] = [];
  for (const o of options) {
    if (!(o.rawTime < o.actualTime)) continue;
    out.push({ ...o, id: `${o.id}~last`, actualTime: o.rawTime, lastInSlot: true });
  }
  return out;
}
