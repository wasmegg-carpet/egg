/**
 * @module fetchBackup
 * @description Pure data-fetching for player backups. No store mutations.
 *
 * Extracted from the old `submitPlayerId` function in App.vue, which combined
 * data fetching with store initialization. Each mode initializer calls this
 * independently and handles its own store population.
 */

import { requestFirstContact, resolveColleggtibleContracts } from 'lib';
import type { ei } from 'lib';
import { hashID, saveMetadata } from '@/lib/storage/db';

export interface BackupResult {
  /** The raw protobuf backup from the server */
  backup: ei.IBackup;
  /** The hashed player ID (used as a DB partition key) */
  pHash: string;
}

/**
 * Fetch a player's backup from the server and cache it in IndexedDB.
 *
 * This is a **pure data operation** — it does NOT mutate any Pinia stores.
 * Each mode initializer is responsible for populating stores from the returned
 * backup according to its own contract.
 *
 * @throws {Error} If the backup cannot be fetched (network error, invalid ID, etc.)
 */
export async function fetchPlayerBackup(playerId: string): Promise<BackupResult> {
  const data = await requestFirstContact(playerId);
  if (!data.backup) {
    throw new Error('Could not fetch player backup');
  }
  resolveColleggtibleContracts(data.backup);

  // Persist to IndexedDB for offline access / cross-session reuse
  const pHash = await hashID(playerId);
  try {
    await saveMetadata(pHash, 'rawBackup', data.backup);
  } catch (dbErr) {
    console.error('Failed to save raw backup to DB', dbErr);
    // Non-fatal — continue with the in-memory backup
  }

  return { backup: data.backup, pHash };
}
