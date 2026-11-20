// The effort level spaces launches and nothing else: consecutive launches in a slot go up at least the launch period
// apart (a day at Low, half a day at Medium, an hour at High), which is what the floored `actualTime` charges, but a
// slot's last launch has nothing after it to space, and only its real flight has to land by the horizon. So each
// option whose flight is shorter than its floored time is offered once more as a variant that may fly only as its
// slot's last launch, charged its real flight (`solver/SPEC.md` section 19). Deliberately not shared with the arena,
// which keeps its own copy (`tests/arena/capacity.ts`, `lastVariants`). Kept free of the loot dataset so the worker
// bundle can import it.

// The fields a variant is built from; generic so display-only fields ride along untouched.
export interface LastVariantSource {
  id: string;
  actualTime: number;
  rawTime: number;
  lastInSlot?: boolean;
}

// For each option the effort floor lengthens (`rawTime < actualTime`), the same flight charged its `rawTime`, marked
// `lastInSlot`, id suffixed `~last`. Nothing for an option the floor leaves as it is, so at Max effort, or for a
// mission longer than the period, there is no variant and the menu is what it was.
export function lastVariants<T extends LastVariantSource>(options: readonly T[]): T[] {
  return options.flatMap(option =>
    option.rawTime < option.actualTime && !option.lastInSlot
      ? [{ ...option, id: `${option.id}~last`, actualTime: option.rawTime, lastInSlot: true }]
      : []
  );
}
