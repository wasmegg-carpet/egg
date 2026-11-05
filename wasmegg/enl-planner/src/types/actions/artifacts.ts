/**
 * Artifact Set types and payloads.
 */

import type { EquippedArtifact } from '../../lib/artifacts/types';

export type ArtifactSetName = 'earnings' | 'elr';

/**
 * Artifact slot in a loadout (serializable).
 */
export type ArtifactSlotPayload = EquippedArtifact;


/**
 * Payload for changing artifact loadout.
 */
export interface ChangeArtifactsPayload {
  fromLoadout: ArtifactSlotPayload[];
  toLoadout: ArtifactSlotPayload[];
}

/**
 * Payload for equipping an artifact set.
 */
export interface EquipArtifactSetPayload {
  setName: ArtifactSetName;
}

/**
 * Payload for updating an artifact set.
 */
export interface UpdateArtifactSetPayload {
  setName: ArtifactSetName;
  newLoadout: ArtifactSlotPayload[];
}
