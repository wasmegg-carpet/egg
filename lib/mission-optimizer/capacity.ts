// The app's 2x mission capacity event: for a window starting now, every mission that launches inside it brings
// home twice its drops, whenever it lands. `optimizeFull` uses this to turn the player's "time left" and a menu
// into the problem `solver/SPEC.md` section 11 describes, as it uses `sleep.ts` for the sleep window.
//
// Deliberately not shared with the arena, which keeps its own copy of the same rule (`tests/arena/capacity.ts`)
// so that the planner's menu is judged by something other than itself; `tests/unit/capacity.spec.ts` holds the
// two to the same answers. Kept free of the loot dataset so the worker bundle can import it.

import type { CapacityVariant } from './types';

// The longest window the app will plan around: the game's events run 48 hours, and a window always starts now,
// so no more than that can be left.
export const MAX_DOUBLE_CAPACITY_SECONDS = 48 * 3600;

// A window as the solver may be handed it: 0 for anything that is not a usable window (absent, non-finite,
// non-positive), and never more than `MAX_DOUBLE_CAPACITY_SECONDS`.
export function eventWindowSecondsOf(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, MAX_DOUBLE_CAPACITY_SECONDS);
}

// The fields a variant is built from; generic so display-only fields ride along untouched, and so the sleep
// variants' `nights` and waking `actualTime` pass through unchanged when the two are composed.
export interface CapacityVariantSource {
  id: string;
  actualTime: number;
  variant?: CapacityVariant;
  supplyVector: Map<string, number>;
  yieldVector: Map<string, number>;
  legendaryYieldVector: Map<string, number>;
}

// Every way each option can sit against a window of `window` seconds starting now:
// - `normal`, at 1x, always;
// - `event`, at 2x, when `actualTime <= window`, so it can go up with something doubled still to follow it;
// - `overhang`, at 2x, always: the last doubled launch of a slot, which may be longer than the window.
// The event multiplies capacity only, so fuel, duration and cost are the option's own; `2 * floor(x)` against
// `floor(2 * x)` is not modelled, these being expected drops per launch. Doubled ids get a `::event` or
// `::overhang` suffix; the normal variant keeps the option's own id. With no window this returns `options`
// itself, untouched: no variant field, today's menu exactly.
export function capacityVariants<T extends CapacityVariantSource>(options: readonly T[], window: number): readonly T[] {
  if (!(window > 0)) return options;
  const twice = (vector: Map<string, number>) => new Map([...vector].map(([k, q]) => [k, 2 * q]));
  const doubled = (option: T, variant: CapacityVariant): T => ({
    ...option,
    id: `${option.id}::${variant}`,
    variant,
    supplyVector: twice(option.supplyVector),
    yieldVector: twice(option.yieldVector),
    legendaryYieldVector: twice(option.legendaryYieldVector),
  });
  const variants: T[] = [];
  for (const option of options) {
    variants.push({ ...option, variant: 'normal' });
    if (option.actualTime <= window) variants.push(doubled(option, 'event'));
    variants.push(doubled(option, 'overhang'));
  }
  return variants;
}
