import type { ei } from 'lib';
import { sanitizeLongs } from 'lib/planners/artifacts/utils';

/** Where this planner reads a player's artifacts from: the virtue artifact inventory. */
export function loadoutSourceFromBackup(backup: ei.IBackup) {
  return backup.artifactsDb?.virtueAfxDb ?? null;
}

/**
 * Produce a redacted `ei.IBackup` for persisting alongside a saved plan, so
 * artifact recalculation (getOptimalELRSet, getOptimalEarningsSet, ...) works
 * after reloading the plan without re-fetching the player's full backup.
 *
 * Keeps only the two things those functions actually read for the
 * strategies this app uses:
 *
 * - The virtue artifact inventory (`artifactsDb.virtueAfxDb`). See the
 *   `isVirtue` branches in lib/artifacts/recommendation.ts, which skip
 *   `backup.farms` entirely; `commonResearch`/`epicResearchLevels`/
 *   `colleggtibleModifiers` are always passed explicitly by every caller
 *   here, sourced from the plan's own stored state, never read off the
 *   backup. `getOptimalELRSet` only reads `backup.farms` when not assuming
 *   maxed habs/vehicles and its caller passes no `habIds`/`vehicles`.
 * - `game.permitLevel` (Pro vs. Standard permit — a single small int, not
 *   remotely account-identifying). Read directly off `rawBackup` by
 *   ArtifactActions.vue, InitialStateContainer.vue, and
 *   useEarningsClothedTE.ts, and also internally by getOptimalEarningsSet
 *   itself to pick PRO_PERMIT_VIRTUE_CTE vs. STANDARD_PERMIT_VIRTUE_CTE —
 *   omitting it doesn't fail loudly, it silently mis-recommends the wrong
 *   permit's artifact set.
 *
 * Everything else — username, contracts, missions, subscription info, farms,
 * and so on — is omitted outright rather than replaced with placeholders.
 *
 * `itemId` is kept as-is (Long-sanitized to a plain number, see below) — it's
 * just a local index into this backup's own inventory list, not an
 * account-identifying value, and `inventoryItems`/`activeArtifacts.slots`
 * need it to agree for lookups (e.g. `getArtifactLoadoutFromBackup`) to keep
 * resolving correctly. `serverId` — the actual server-assigned, per-account
 * identifier, and never read anywhere in this app — is what's dropped
 * outright, not replaced with a placeholder.
 */
export function redactBackupForStorage(backup: ei.IBackup): ei.IBackup | null {
  const db = backup.artifactsDb?.virtueAfxDb;
  const permitLevel = backup.game?.permitLevel;
  if (!db && permitLevel == null) return null;

  let artifactsDb: ei.IArtifactsDB | undefined;
  if (db) {
    // Long-typed int64 fields (itemId) decode to protobufjs Long instances that
    // don't survive a JSON round-trip intact — flatten them to plain numbers.
    const sanitizedDb = sanitizeLongs(db) as ei.ArtifactsDB.IVirtueDB;

    const inventoryItems: ei.IArtifactInventoryItem[] = (sanitizedDb.inventoryItems || []).map(item => ({
      itemId: item.itemId,
      quantity: item.quantity,
      artifact: item.artifact
        ? {
            spec: item.artifact.spec ? { ...item.artifact.spec } : undefined,
            stones: (item.artifact.stones || []).map(s => ({ ...s })),
          }
        : undefined,
      // serverId intentionally omitted.
    }));

    const activeArtifacts = sanitizedDb.activeArtifacts
      ? {
          // uid intentionally omitted — unused anywhere in this app.
          slots: (sanitizedDb.activeArtifacts.slots || []).map(slot => ({
            occupied: slot.occupied,
            itemId: slot.itemId,
          })),
        }
      : undefined;

    artifactsDb = { virtueAfxDb: { inventoryItems, activeArtifacts } };
  }

  return {
    game: permitLevel != null ? { permitLevel } : undefined,
    artifactsDb,
  };
}
