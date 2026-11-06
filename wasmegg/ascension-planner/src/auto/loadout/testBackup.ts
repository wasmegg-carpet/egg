/**
 * Test-only helpers: a minimal synthetic backup with just a virtue artifact inventory.
 * Artifact `level` is tier - 1 (T4 = 3); stone `level` is tier - 2 (T4 = 2).
 */
import { ei } from 'lib/proto';

export const AfxName = ei.ArtifactSpec.Name;
export const AfxRarity = ei.ArtifactSpec.Rarity;

let nextItemId = 1;

export function invArtifact(
  name: ei.ArtifactSpec.Name,
  tier: number,
  rarity: ei.ArtifactSpec.Rarity,
  quantity = 1
): ei.IArtifactInventoryItem {
  return { itemId: nextItemId++, quantity, artifact: { spec: { name, level: tier - 1, rarity }, stones: [] } };
}

export function invStone(name: ei.ArtifactSpec.Name, tier: number, quantity: number): ei.IArtifactInventoryItem {
  return {
    itemId: nextItemId++,
    quantity,
    artifact: { spec: { name, level: tier - 2, rarity: ei.ArtifactSpec.Rarity.COMMON }, stones: [] },
  };
}

export function syntheticBackup(inventoryItems: ei.IArtifactInventoryItem[]): ei.IBackup {
  return {
    artifactsDb: { virtueAfxDb: { inventoryItems } },
    farms: [],
    game: { epicResearch: [] },
  };
}
