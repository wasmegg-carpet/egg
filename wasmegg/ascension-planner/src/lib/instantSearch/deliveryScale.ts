/**
 * The delivery adjustment, ported from AutoAutoAP (their src/search/leg.ts `instantDeliveryScale`):
 * the player's peak delivery rate against the precomputed table's, at the research a build waits with
 * (the table's `k3`). The best set the player's whole inventory can wear there, through the
 * calculator's own rate function: at that research nearly every stone goes to lay rate, so the set a
 * save shows (chosen at today's research) would understate everyone. 1 without a save to read.
 */
import { calculateArtifactModifiers, getOptimalELRSet, sanitizeLongs } from '@/lib/artifacts';
import type { EquippedArtifact } from '@/lib/artifacts/types';
import { computeRealisticELR } from '@/calculations/realisticELR';
import type { GearContext } from './tableGear';

/** The waiting research and delivery set a table's header records (its `k3`). */
export interface K3Record {
  research: Record<string, number>;
  delivery: unknown[];
}

export function instantDeliveryScale(context: GearContext, k3: K3Record): number {
  const raw = context.rawBackup;
  if (!raw) return 1;
  const rate = (set: EquippedArtifact[]) =>
    computeRealisticELR(
      k3.research,
      calculateArtifactModifiers(set),
      context.epicResearchLevels,
      context.colleggtibleModifiers
    ).effectiveRate;
  const mine = getOptimalELRSet(sanitizeLongs(raw) as typeof raw, {
    commonResearch: k3.research,
    epicResearchLevels: context.epicResearchLevels,
    colleggtibleModifiers: context.colleggtibleModifiers,
    assumeMaxHabsVehicles: true,
  });
  const theirs = rate(k3.delivery as EquippedArtifact[]);
  return mine && theirs > 0 ? rate(mine as EquippedArtifact[]) / theirs : 1;
}
