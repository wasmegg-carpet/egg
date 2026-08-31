import { iconURL } from 'lib/utils';
import { allPossibleTiers } from 'lib/artifacts/data';
import { Artifact, newItem } from 'lib/artifacts';
import { ei } from 'lib';
import { EquippedArtifact } from './types';
import { getArtifact, getStone, stoneOptions } from './data';
import { createEmptyLoadout } from './calculator';

/**
 * Summarize an artifact loadout for display in action history.
 */
export function summarizeLoadout(loadout: EquippedArtifact[]): string {
  const parts: string[] = [];
  for (const slot of loadout) {
    const artifact = getArtifact(slot.artifactId);
    if (artifact) {
      parts.push(
        `T${artifact.tier}${artifact.rarityCode} <img src="${iconURL(artifact.iconPath, 32)}" class="h-4 w-4 inline-block align-middle -mt-0.5" title="${artifact.label}" />`
      );
    }
  }

  const stoneCounts = new Map<string, { label: string; count: number; order: number; iconPath: string }>();
  const stoneOrderMap = new Map(stoneOptions.map((s, i) => [s.id, i]));

  for (const slot of loadout) {
    for (const stoneId of slot.stones) {
      if (!stoneId) continue;
      const stone = getStone(stoneId);
      if (stone) {
        const existing = stoneCounts.get(stoneId);
        if (existing) {
          existing.count++;
        } else {
          stoneCounts.set(stoneId, {
            label: stone.label,
            count: 1,
            order: stoneOrderMap.get(stoneId) ?? 999,
            iconPath: stone.iconPath,
          });
        }
      }
    }
  }

  const sortedStones = Array.from(stoneCounts.values()).sort((a, b) => a.order - b.order);
  for (const stone of sortedStones) {
    parts.push(
      `${stone.count}x <img src="${iconURL(stone.iconPath, 32)}" class="h-3.5 w-3.5 inline-block align-middle -mt-0.5" title="${stone.label}" />`
    );
  }

  return parts.length > 0 ? parts.join(', ') : 'No artifacts equipped';
}



/**
 * Convert a lib Artifact to the planner's EquippedArtifact format.
 */
export function libArtifactToEquippedArtifact(afx: Artifact): EquippedArtifact {
  const tier = allPossibleTiers.find(t => t.afx_id === afx.afxId && t.afx_level === afx.afxLevel);
  if (!tier) {
    return { artifactId: null, stones: [] };
  }

  const artifactId = `${tier.family.id}-${tier.tier_number}-${afx.afxRarity}`;
  const stones = afx.stones.map(s => {
    const stoneTier = allPossibleTiers.find(t => t.afx_id === s.afxId && t.afx_level === s.afxLevel);
    return stoneTier ? `${stoneTier.family.id}-${stoneTier.tier_number}` : null;
  });

  return { artifactId, stones };
}

/**
 * Convert the planner's EquippedArtifact format (with stones) into lib `Artifact[]`,
 * the format consumed by the shared Clothed TE formulas (`cteFromArtifacts`, etc).
 * Inverse of {@link libArtifactToEquippedArtifact}.
 */
export function equippedArtifactsToLibArtifacts(loadout: EquippedArtifact[]): Artifact[] {
  const result: Artifact[] = [];
  for (const slot of loadout) {
    const option = getArtifact(slot.artifactId);
    if (!option) continue;
    const tier = allPossibleTiers.find(t => t.family.id === option.familyId && t.tier_number === option.tier);
    if (!tier) continue;

    const host = newItem({ name: option.afxId, level: tier.afx_level, rarity: option.rarity });
    const stones = slot.stones
      .map(id => getStone(id))
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .map(stone => allPossibleTiers.find(t => t.family.id === stone.familyId && t.tier_number === stone.tier))
      .filter((t): t is NonNullable<typeof t> => t !== undefined)
      .map(t => newItem({ name: t.afx_id, level: t.afx_level, rarity: ei.ArtifactSpec.Rarity.COMMON }));

    result.push(new Artifact(host, stones));
  }
  return result;
}

/**
 * Parse equipped artifacts and stones from a player backup.
 */
export function getArtifactLoadoutFromBackup(backup: ei.IBackup): EquippedArtifact[] {
  const loadout = createEmptyLoadout();
  const db = backup.artifactsDb?.virtueAfxDb;
  if (!db) {
    return loadout;
  }
  const inventoryItems = db.inventoryItems || [];
  const activeArtifacts = db.activeArtifacts;
  if (!activeArtifacts || !activeArtifacts.slots) {
    return loadout;
  }
  const itemIdToArtifact = new Map<number, ei.ICompleteArtifact>(
    inventoryItems
      .filter(item => item.itemId !== undefined && item.itemId !== null && item.artifact)
      .map(item => [item.itemId!, item.artifact!])
  );

  for (let i = 0; i < Math.min(4, activeArtifacts.slots.length); i++) {
    const slot = activeArtifacts.slots[i];
    if (slot.occupied && slot.itemId !== undefined && slot.itemId !== null) {
      const artifact = itemIdToArtifact.get(slot.itemId);
      if (artifact && artifact.spec) {
        const spec = artifact.spec;
        const tier = allPossibleTiers.find(t => t.afx_id === spec.name && t.afx_level === spec.level);
        if (tier) {
          const artifactId = `${tier.family.id}-${tier.tier_number}-${spec.rarity || 0}`;
          const stones: (string | null)[] = [];
          if (artifact.stones) {
            for (const stoneSpec of artifact.stones) {
              const stoneTier = allPossibleTiers.find(
                t => t.afx_id === stoneSpec.name && t.afx_level === stoneSpec.level
              );
              if (stoneTier) {
                stones.push(`${stoneTier.family.id}-${stoneTier.tier_number}`);
              }
            }
          }
          loadout[i] = { artifactId, stones };
        }
      }
    }
  }
  return loadout;
}

/**
 * Duck-typed check for a protobufjs-decoded Long (from the 'long' package): every ei.IBackup int64/
 * uint64/sint64/fixed64 field (e.g. ArtifactInventoryItem.itemId, ArtifactsDB.itemSequence,
 * Backup.checksum, Game.soulEggs, ...) decodes to one of these — a plain object with exactly these
 * three own enumerable properties, `{ low, high, unsigned }`, plus arithmetic/comparison methods on
 * its prototype (Long.prototype). Not imported from the 'long' package directly: it isn't a direct
 * dependency of this workspace (only a transitive one, pulled in indirectly via protobufjs/the
 * generated ei proto — pnpm's workspace isolation makes that resolution fragile to depend on
 * directly), and duck-typing is all sanitizeLongs actually needs anyway.
 */
function isLongLike(value: unknown): value is { low: number; high: number; unsigned: boolean } {
  if (typeof value !== 'object' || value === null) return false;
  const keys = Object.keys(value);
  const v = value as Record<string, unknown>;
  return (
    keys.length === 3 && typeof v.low === 'number' && typeof v.high === 'number' && typeof v.unsigned === 'boolean'
  );
}

/** Same bit math as Long.prototype.toNumber() (long@5's index.js) — reimplemented rather than
 *  imported for the same reason isLongLike duck-types instead of using `instanceof Long`. Loses
 *  precision the same way the real .toNumber() would for values beyond Number.MAX_SAFE_INTEGER;
 *  that's an existing characteristic of calling .toNumber() anywhere in this codebase, not a
 *  regression introduced here. */
function longLikeToNumber(value: { low: number; high: number; unsigned: boolean }): number {
  const TWO_PWR_32_DBL = 4294967296;
  return value.unsigned
    ? (value.high >>> 0) * TWO_PWR_32_DBL + (value.low >>> 0)
    : value.high * TWO_PWR_32_DBL + (value.low >>> 0);
}

/**
 * Deep-clones a value into a plain, JSON-safe copy: rebuilds every plain object/array from scratch
 * via Object.entries rather than returning `value` itself, and converts any Long-shaped object
 * encountered anywhere in the tree into a plain JS number along the way. Needed for
 * `redactBackupForStorage` below — the redacted backup gets JSON-serialized into IndexedDB, and a
 * protobufjs Long instance does NOT survive a JSON round-trip intact (`JSON.stringify` reads its own
 * enumerable `{low,high,unsigned}` properties, same as any plain object, silently dropping
 * `Long.prototype`'s methods on the way back in).
 *
 * Exported for `researchCalc.worker.ts` too: a `postMessage`/`structuredClone` boundary hits the
 * exact same Long-shaped-object problem (confirmed for real against protobufjs Long instances by
 * the beam search worker this was originally written for — see git history around `ce0be3af`), and
 * this function's duck-typed check handles either a live `Long` or its already-clone-stripped
 * `{low,high,unsigned}` equivalent identically, so it's correct on either side of that boundary.
 */
export function sanitizeLongs<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => sanitizeLongs(item)) as unknown as T;
  }
  if (isLongLike(value)) {
    return longLikeToNumber(value) as unknown as T;
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sanitizeLongs(v);
    }
    return out as T;
  }
  return value;
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
 *   backup.
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
