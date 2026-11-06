/**
 * Executor types shared by the planners.
 *
 * Each planner's src/lib/actions/executor.ts builds its own `ActionExecutor<T>` (keyed by its own
 * action union) and `ExecutorContext` (which adds the fuel-egg methods) on top of these. Executors
 * that don't touch fuel are written against these shared types so both planners can register them.
 */

import type { ArtifactSlotPayload } from '../types';

/**
 * Interface for action executors.
 * Each action type needs an executor that handles its logic.
 */
export interface PayloadExecutor<P, Ctx = BaseExecutorContext> {
  /**
   * Apply the action to stores and return the cost.
   */
  execute(payload: P, context: Ctx): number;

  /**
   * Get a human-readable display name for the action.
   */
  getDisplayName(payload: P): string;

  /**
   * Get a description of the action's effect.
   */
  getEffectDescription(payload: P): string;
}

/**
 * Context passed to executors with store access (everything except the planner's fuel eggs).
 */
export interface BaseExecutorContext {
  // Store setters
  setHab(slotIndex: number, habId: number | null): void;
  setVehicle(slotIndex: number, vehicleId: number | null): void;
  setTrainLength(slotIndex: number, length: number): void;
  setResearchLevel(researchId: string, level: number): void;
  setArtifactLoadout(loadout: ArtifactSlotPayload[]): void;
  setSiloCount(count: number): void;

  // Current state readers
  getHabIds(): (number | null)[];
  getVehicles(): { vehicleId: number | null; trainLength: number }[];
  getResearchLevels(): Record<string, number>;
  getSiloCount(): number;
  getSiloCapacityLevel(): number;

  // Cost modifiers
  getHabCostModifiers(): { cheaperContractorsLevel: number; habCostMultiplier: number };
  getVehicleCostModifiers(): { bustUnionsLevel: number; vehicleCostMultiplier: number };
  getResearchCostModifiers(): { labUpgradeLevel: number; researchCostMultiplier: number; puzzleCubeMultiplier: number };
}
