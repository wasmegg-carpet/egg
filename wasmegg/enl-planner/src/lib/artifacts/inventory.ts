/**
 * What the player actually owns, by planner id. Stones socketed in an artifact count, since the
 * player can take them out and use them elsewhere.
 *
 * A null inventory means it isn't known (no backup, or a plan saved before inventories were kept):
 * everything then counts as owned.
 */
import { allPossibleTiers } from 'lib/artifacts/data';
import { ei } from 'lib/proto';
import { loadoutSourceFromBackup } from './backupArtifacts';
import { getArtifact, getStone } from './data';
import type { EquippedArtifact } from './types';

export interface PlayerInventory {
  artifacts: Record<string, number>;
  stones: Record<string, number>;
}

export interface InventoryOverage {
  id: string;
  label: string;
  used: number;
  owned: number;
}

const tierBySpec = new Map(allPossibleTiers.map(t => [`${t.afx_id}:${t.afx_level}`, t]));

export function inventoryFromBackup(backup: ei.IBackup): PlayerInventory | null {
  const source = loadoutSourceFromBackup(backup);
  if (!source) return null;
  const inventory: PlayerInventory = { artifacts: {}, stones: {} };

  const add = (spec: ei.IArtifactSpec, count: number) => {
    const tier = tierBySpec.get(`${spec.name}:${spec.level}`);
    if (!tier) return;
    if (tier.afx_type === ei.ArtifactSpec.Type.ARTIFACT) {
      const id = `${tier.family.id}-${tier.tier_number}-${spec.rarity || 0}`;
      inventory.artifacts[id] = (inventory.artifacts[id] ?? 0) + count;
    } else if (tier.afx_type === ei.ArtifactSpec.Type.STONE) {
      const id = `${tier.family.id}-${tier.tier_number}`;
      inventory.stones[id] = (inventory.stones[id] ?? 0) + count;
    }
  };

  for (const item of source.inventoryItems ?? []) {
    const count = item.quantity ?? 0;
    if (!item.artifact?.spec || count <= 0) continue;
    add(item.artifact.spec, count);
    for (const stone of item.artifact.stones ?? []) add(stone, count);
  }

  // Quantities are stored as floating point; only whole items can be used.
  for (const counts of [inventory.artifacts, inventory.stones]) {
    for (const id of Object.keys(counts)) counts[id] = Math.floor(counts[id] + 1e-9);
  }
  return inventory;
}

/** How many of a stone the player has; unlimited when the inventory isn't known. */
export function ownedStoneCount(inventory: PlayerInventory | null | undefined, stoneId: string): number {
  return inventory ? (inventory.stones[stoneId] ?? 0) : Infinity;
}

export function ownsArtifact(inventory: PlayerInventory | null | undefined, artifactId: string): boolean {
  return inventory ? (inventory.artifacts[artifactId] ?? 0) > 0 : true;
}

/** The artifacts and stones a set uses more of than the player has. Pass only the slots that count. */
export function inventoryOverages(
  loadout: EquippedArtifact[],
  inventory: PlayerInventory | null | undefined
): InventoryOverage[] {
  if (!inventory) return [];
  const artifacts = new Map<string, number>();
  const stones = new Map<string, number>();
  for (const slot of loadout) {
    if (!slot.artifactId) continue;
    artifacts.set(slot.artifactId, (artifacts.get(slot.artifactId) ?? 0) + 1);
    for (const id of slot.stones) if (id) stones.set(id, (stones.get(id) ?? 0) + 1);
  }
  const over = (used: Map<string, number>, owned: (id: string) => number, label: (id: string) => string | undefined) =>
    [...used]
      .filter(([id, count]) => count > owned(id))
      .map(([id, count]) => ({ id, label: label(id) ?? id, used: count, owned: owned(id) }));
  return [
    ...over(artifacts, id => inventory.artifacts[id] ?? 0, id => getArtifact(id)?.label),
    ...over(stones, id => ownedStoneCount(inventory, id), id => getStone(id)?.label),
  ];
}
