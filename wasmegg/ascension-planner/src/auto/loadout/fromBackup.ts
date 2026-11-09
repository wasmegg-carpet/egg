import type { ei } from 'lib/proto';
import { Inventory } from 'lib/artifacts';
import { getArtifact } from '@/lib/artifacts/data';
import { createEmptyLoadout } from '@/lib/artifacts/calculator';
import type { EquippedArtifact } from '@/lib/artifacts/types';
import { buildDeliveryPoolFromBackup, getOptimalEarningsSet, isDeliveryTargetArtifact } from '@/lib/artifacts/virtue';
import {
  createEmptyStonePool,
  STONE_FAMILIES,
  STONE_TIERS,
  type AutoLoadoutInputs,
  type DeliveryCandidate,
  type StonePool,
  type StoneTier,
} from './types';

/** Copy of a loadout with every stone slot emptied (earnings stones are socketed by C1 from the pool). */
export function withEmptyStones(loadout: (EquippedArtifact | null)[]): EquippedArtifact[] {
  const out: EquippedArtifact[] = loadout.slice(0, 4).map(slot => ({
    artifactId: slot?.artifactId ?? null,
    stones: new Array(getArtifact(slot?.artifactId ?? null)?.slots ?? 0).fill(null),
  }));
  while (out.length < 4) out.push({ artifactId: null, stones: [] });
  return out;
}

export function toDeliveryCandidate(artifactId: string): DeliveryCandidate {
  return {
    artifactId,
    slots: getArtifact(artifactId)?.slots ?? 0,
    isTarget: isDeliveryTargetArtifact(artifactId),
  };
}

/** T2-T4 lunar/shell/quantum/tachyon counts in the backup's virtue inventory (socketed ones included). */
export function stonePoolFromBackup(backup: ei.IBackup): StonePool {
  const pool = createEmptyStonePool();
  if (!backup.artifactsDb) return pool;
  const inventory = new Inventory(backup.artifactsDb, { virtue: true });
  for (const item of inventory.items) {
    if (!item.isStone) continue;
    const family = STONE_FAMILIES.find(f => item.props.family.id === `${f}-stone`);
    const tier = item.tierNumber as StoneTier;
    if (family && (STONE_TIERS as readonly number[]).includes(tier)) {
      pool[family][tier] = item.haveCommon;
    }
  }
  return pool;
}

/**
 * The setup form's default inputs: the recommended earnings set, an `auto` delivery set over the
 * inventory's delivery candidates, and the inventory's stone counts. `proPermit` defaults to the
 * backup's own permit; with Standard the earnings set has only 2 artifacts.
 */
export function buildLoadoutInputsFromBackup(
  backup: ei.IBackup,
  proPermit: boolean = backup.game?.permitLevel === 1
): AutoLoadoutInputs {
  return {
    earnings: withEmptyStones(getOptimalEarningsSet(backup, proPermit)),
    delivery: { mode: 'auto', candidates: buildDeliveryPoolFromBackup(backup).candidates.map(toDeliveryCandidate) },
    stones: stonePoolFromBackup(backup),
  };
}

/**
 * Fallback when there's no backup (e.g. a plan loaded without a player ID): the manual planner's
 * saved sets, a `fixed` delivery set, and no stones.
 */
export function buildLoadoutInputsFromSets(sets: {
  earnings?: EquippedArtifact[] | null;
  elr?: EquippedArtifact[] | null;
}): AutoLoadoutInputs {
  const elr = sets.elr ?? createEmptyLoadout();
  const artifactIds = elr.slice(0, 4).map(slot => slot?.artifactId ?? null);
  while (artifactIds.length < 4) artifactIds.push(null);
  return {
    earnings: withEmptyStones(sets.earnings ?? createEmptyLoadout()),
    delivery: { mode: 'fixed', artifactIds },
    stones: createEmptyStonePool(),
  };
}
