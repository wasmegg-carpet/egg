/**
 * Which step of an auto planner build a part-way ascension is on, read from the farm Continue starts
 * from (`makeContinueState`). Continue plans the rest of the ascension from the very beginning of that
 * step; a finished build just waits out TE at the farm's current rate (`runContinueCurrent`).
 */
import type { EngineState } from '@/engine/types';
import { getResearchById } from '@/calculations/commonResearch';
import { calculateMaxVehicleSlots } from 'lib/planners/calculations/shippingCapacity';
import { HYPERLOOP_ID } from 'lib/planners/calculations/plannerVehiclePurchasePlan';
import { detectArtifactSet } from '@/lib/artifacts/detectSet';

export type BuildStep = 'C1' | 'K1' | 'I1' | 'C2' | 'K2' | 'R1' | 'C3';

const MAX_VEHICLE_SLOTS = 17;
const DELIVERY_ARTIFACT_PREFIXES = ['interstellar-compass-', 'quantum-metronome-'];

/**
 * True when the loadout is a delivery set: its stones say so (`detectArtifactSet`), or, when the
 * stones can't tell, it has a compass or metronome on.
 */
export function isDeliveryLoadout(loadout: EngineState['artifactLoadout']): boolean {
  const detected = detectArtifactSet(loadout);
  if (detected) return detected === 'elr';
  return loadout.some(slot => DELIVERY_ARTIFACT_PREFIXES.some(p => slot.artifactId?.startsWith(p)));
}

/** `base` ("Continue"), plus the build step Continue starts from when the farm was part-way through
 * its build (`AscensionSummary.continueFromStep`). */
export function continueLabel(step: BuildStep | undefined, base = 'Continue'): string {
  return step ? `${base} (from ${step})` : base;
}

/** The build step `state` is on, or null when its build is done (delivery set on, or on Humility). */
export function detectBuildStep(state: EngineState): BuildStep | null {
  if (isDeliveryLoadout(state.artifactLoadout)) return null;

  switch (state.currentEgg) {
    case 'humility':
      return null;
    case 'integrity':
      return 'I1';
    case 'resilience':
      return 'R1';
    case 'kindness':
      return calculateMaxVehicleSlots(state.researchLevels) >= MAX_VEHICLE_SLOTS ? 'K2' : 'K1';
    case 'curiosity': {
      const av = getResearchById('autonomous_vehicles');
      if (av && (state.researchLevels[av.id] || 0) < av.levels) return 'C1';
      const hyperloops = state.vehicles.filter(v => v.vehicleId === HYPERLOOP_ID).length;
      if (hyperloops < MAX_VEHICLE_SLOTS) return 'C2';
      return 'C3';
    }
  }
}
