import type { ei } from 'lib';

/** Where this planner reads a player's artifacts from: the home farm's set in the regular inventory. */
export function loadoutSourceFromBackup(backup: ei.IBackup) {
  const db = backup.artifactsDb;
  if (!db) return null;
  // The sets are per farm, and index 0 is the home farm: the one an enlightenment egg is on.
  return { inventoryItems: db.inventoryItems, activeArtifacts: db.activeArtifactSets?.[0] };
}

/**
 * The part of a backup worth saving with a plan: its permit level. Loadouts are read from a live
 * backup and copied into the plan, and the inventory is saved separately as plain counts, so
 * leaving everything else out keeps names, contracts and ids out of exported plan files.
 */
export function redactBackupForStorage(backup: ei.IBackup): ei.IBackup | null {
  const permitLevel = backup.game?.permitLevel;
  return permitLevel != null ? { game: { permitLevel } } : null;
}
