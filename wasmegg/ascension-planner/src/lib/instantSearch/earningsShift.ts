/**
 * How far a player's earnings artifacts are below the table's, in Clothed TE. Each TE is ×1.1 earnings
 * and Clothed TE is the earnings set's effects in the same log₁.₁ terms, so artifacts that earn 1.1^Δ
 * less are a table row Δ TE lower (table.ts `shiftedLookup`).
 *
 * The player's set is measured the way the table's was (buildTable/task.ts `cteBonusOf`): the
 * earnings artifacts, socketed from the whole lunar and shell stone pool.
 */
import type { ei } from 'lib';
import { cteFromArtifacts } from 'lib/virtue';
import { equippedArtifactsToLibArtifacts } from '@/lib/artifacts/utils';
import {
  buildLoadoutInputsFromBackup,
  seedFixedDeliveryFromAuto,
  socketEarningsStones,
  type AutoLoadoutInputs,
} from '@/auto/loadout';
import type { TableHeader } from './table';
import { getArtifact } from '@/lib/artifacts';
import type { EquippedArtifact } from '@/lib/artifacts/types';
import { deliveryCore, deliveryCoreKey } from './tableCatalog';

/** The earnings set's slots in Chain Finder, one family each, in this order. */
export const CHAIN_FINDER_EARNINGS_FAMILIES = ['tungsten-ankh', 'demeters-necklace', 'lunar-totem', 'puzzle-cube'];

/** The delivery set's fourth slot in Chain Finder: only its stone slots count, so a lunar totem with
 *  that many stands in for any holder. The 3-slot one is the Table Builder's. */
export const STONE_HOLDERS = [
  { id: 'lunar-totem-4-3', label: '3-slot' },
  { id: 'lunar-totem-4-2', label: '2-slot' },
  { id: 'lunar-totem-4-1', label: '1-slot' },
];

/**
 * A loadout in Chain Finder's shape: the earnings set as ankh, necklace, totem, cube; the delivery set
 * fixed, as metronome, compass, gusset (tableCatalog.ts `deliveryCore`) and the 3-slot stone holder.
 * A family the loadout lacks is an empty slot.
 */
export function chainFinderLoadout(inputs: AutoLoadoutInputs): AutoLoadoutInputs {
  const earnings = CHAIN_FINDER_EARNINGS_FAMILIES.map(
    family =>
      inputs.earnings.find(slot => getArtifact(slot.artifactId)?.familyId === family) ??
      ({ artifactId: null, stones: [] } as EquippedArtifact)
  );
  const ids = inputs.delivery.mode === 'fixed' ? inputs.delivery.artifactIds : seedFixedDeliveryFromAuto(inputs);
  return {
    ...inputs,
    earnings,
    delivery: { mode: 'fixed', artifactIds: [...deliveryCore(ids), STONE_HOLDERS[0].id] },
  };
}

/**
 * The artifacts and stones Chain Finder starts from for a save: its recommended earnings set, its
 * best delivery set as a fixed structure (what a table is built for), and its stones.
 */
export function chainFinderLoadoutFromBackup(backup: ei.IBackup): AutoLoadoutInputs {
  return chainFinderLoadout(buildLoadoutInputsFromBackup(backup));
}

/** Clothed TE of the earnings set socketed from the stone pool (artifacts only). */
export function earningsCTE(inputs: AutoLoadoutInputs): number {
  return cteFromArtifacts(equippedArtifactsToLibArtifacts(socketEarningsStones(inputs.earnings, inputs.stones)));
}

/**
 * Clothed TE the earnings artifacts are below the table's, to two places like the header's
 * `cteBonus`; 0 with no inputs. Never below 0: the tables are built on maxed artifacts.
 */
export function earningsShift(inputs: AutoLoadoutInputs | null, header: Pick<TableHeader, 'cteBonus'>): number {
  if (!inputs) return 0;
  return Math.max(0, Number((header.cteBonus - earningsCTE(inputs)).toFixed(2)));
}

/** Whether the inputs' fixed delivery set has the metronome, compass and gusset the table was built
 *  with (any order; tableCatalog.ts `deliveryCoreKey`). A table can't be adjusted for others: C3 buys
 *  different research for them. */
export function deliveryMatchesTable(inputs: AutoLoadoutInputs, header: Pick<TableHeader, 'delivery'>): boolean {
  if (!header.delivery || inputs.delivery.mode !== 'fixed') return true;
  return deliveryCoreKey(inputs.delivery.artifactIds) === deliveryCoreKey(header.delivery);
}
