/**
 * Pure calculation functions for Shipping Capacity.
 * These have no Vue dependencies and are fully testable.
 */

import type {
  Research,
  ResearchLevels,
  ShippingCapacityInput,
  ShippingCapacityOutput,
  BaseCalculationResearch,
} from '../types';
import { vehicleTypes, getVehicleType, BASE_FLEET_SIZE, BASE_TRAIN_LENGTH } from '../vehicles';
import { allResearches } from '../../index';
import { calculateLinearEffect, selectResearches } from '../utils/research';

/**
 * Shipping capacity research with flags for hover/hyperloop-only effects.
 */
interface ShippingCapacityResearch extends BaseCalculationResearch {
  hoverOnly: boolean;
  hyperloopOnly: boolean;
}

/**
 * Fleet size research (+1 slot per level).
 */
interface FleetSizeResearch extends BaseCalculationResearch {}

// Shipping capacity research IDs (from researches.json)
// Note: transportation_lobbyist is an EPIC research and is handled separately
const shippingCapacityResearchIds = [
  'leafsprings', // Improved Leafsprings
  'lightweight_boxes', // Lightweight Boxes
  'driver_training', // Driver Training
  'super_alloy', // Super Alloy Frames
  'quantum_storage', // Quantum Egg Storage
  'hover_upgrades', // Hover Upgrades (hover only)
  'dark_containment', // Dark Containment
  'neural_net_refine', // Neural Net Refinement
  'hyper_portalling', // Hyper Portalling (hyperloop only)
];

// Fleet size research IDs
const fleetSizeResearchIds = [
  'vehicle_reliablity', // Vehicle Reliability
  'excoskeletons', // Depot Worker Exoskeletons
  'traffic_management', // Traffic Management
  'egg_loading_bots', // Egg Loading Bots
  'autonomous_vehicles', // Autonomous Vehicles
];

// Graviton coupling research ID (increases train length)
export const GRAVITON_COUPLING_ID = 'micro_coupling';

// Build capacity researches from JSON
const capacityResearches: ShippingCapacityResearch[] = selectResearches(shippingCapacityResearchIds, r => ({
  id: r.id,
  name: r.name,
  description: r.description,
  maxLevel: r.levels,
  perLevel: r.per_level,
  hoverOnly: r.id === 'hover_upgrades',
  hyperloopOnly: r.id === 'hyper_portalling',
}));

// Build fleet size researches from JSON
const fleetSizeResearches: FleetSizeResearch[] = selectResearches(fleetSizeResearchIds, r => ({
  id: r.id,
  name: r.name,
  description: r.description,
  maxLevel: r.levels,
  perLevel: r.per_level,
}));

// Get graviton coupling research from JSON
const gravitonCouplingResearch = (allResearches as Research[]).find(r => r.id === GRAVITON_COUPLING_ID);

/**
 * Calculate research multiplier (1 + perLevel * level).
 */
function calculateResearchMultiplier(perLevel: number, level: number, maxLevel: number): number {
  return calculateLinearEffect(level, maxLevel, perLevel);
}

/**
 * Calculate max vehicle slots based on fleet size research.
 */
export function calculateMaxVehicleSlots(researchLevels: ResearchLevels): number {
  let totalSlots = BASE_FLEET_SIZE;
  for (const research of fleetSizeResearches) {
    const level = researchLevels[research.id] || 0;
    const clampedLevel = Math.max(0, Math.min(level, research.maxLevel));
    totalSlots += clampedLevel * research.perLevel;
  }
  return totalSlots;
}

/**
 * Calculate max train length based on graviton coupling research.
 */
export function calculateMaxTrainLength(researchLevels: ResearchLevels): number {
  if (!gravitonCouplingResearch) return BASE_TRAIN_LENGTH;
  const level = researchLevels[GRAVITON_COUPLING_ID] || 0;
  const clampedLevel = Math.max(0, Math.min(level, gravitonCouplingResearch.levels));
  return BASE_TRAIN_LENGTH + clampedLevel;
}

/**
 * Calculate shipping capacity multipliers from research.
 */
export function calculateShippingMultipliers(
  researchLevels: ResearchLevels,
  transportationLobbyistLevel: number
): {
  universalMultiplier: number;
  hoverMultiplier: number;
  hyperloopMultiplier: number;
  epicMultiplier: number;
} {
  // Calculate multipliers from capacity research
  let universalMultiplier = 1;
  let hoverMultiplier = 1;
  let hyperloopMultiplier = 1;

  for (const research of capacityResearches) {
    const level = researchLevels[research.id] || 0;
    const mult = calculateResearchMultiplier(research.perLevel, level, research.maxLevel);
    if (research.hoverOnly) {
      hoverMultiplier *= mult;
    } else if (research.hyperloopOnly) {
      hyperloopMultiplier *= mult;
    } else {
      universalMultiplier *= mult;
    }
  }

  // Epic multiplier (Transportation Lobbyists: +5% per level, max 30 levels)
  const epicMultiplier = 1 + Math.min(30, Math.max(0, transportationLobbyistLevel)) * 0.05;

  return {
    universalMultiplier,
    hoverMultiplier,
    hyperloopMultiplier,
    epicMultiplier,
  };
}

/**
 * Main calculation: compute shipping capacity with full breakdown.
 */
export function calculateShippingCapacity(input: ShippingCapacityInput): ShippingCapacityOutput {
  const {
    vehicles,
    researchLevels,
    transportationLobbyistLevel,
    shippingCapMultiplier,
    artifactMultiplier,
    artifactEffects,
  } = input;

  // Calculate multipliers
  const { universalMultiplier, hoverMultiplier, hyperloopMultiplier, epicMultiplier } = calculateShippingMultipliers(
    researchLevels,
    transportationLobbyistLevel
  );

  // Calculate max slots and train length
  const maxVehicleSlots = calculateMaxVehicleSlots(researchLevels);
  const maxTrainLength = calculateMaxTrainLength(researchLevels);

  // Calculate per-vehicle capacities
  let totalBaseCapacity = 0;
  let totalFinalCapacity = 0;

  const vehicleBreakdown = vehicles.map((slot, index) => {
    if (slot.vehicleId === null) {
      return {
        slotIndex: index,
        vehicleId: null,
        vehicleName: null,
        trainLength: 1,
        baseCapacity: 0,
        universalMultiplier: 1,
        hoverMultiplier: 1,
        hyperloopMultiplier: 1,
        shippingCapMultiplier: 1,
        artifactMultiplier: 1,
        finalCapacity: 0,
      };
    }

    const vehicleType = getVehicleType(slot.vehicleId);
    if (!vehicleType) {
      return {
        slotIndex: index,
        vehicleId: slot.vehicleId,
        vehicleName: 'Unknown',
        trainLength: 1,
        baseCapacity: 0,
        universalMultiplier: 1,
        hoverMultiplier: 1,
        hyperloopMultiplier: 1,
        shippingCapMultiplier: 1,
        artifactMultiplier: 1,
        finalCapacity: 0,
      };
    }

    // Train length only applies to hyperloop
    const trainLength = vehicleType.isHyperloop ? Math.min(slot.trainLength, maxTrainLength) : 1;

    // Base capacity (multiplied by train length for hyperloop)
    const baseCapacity = vehicleType.baseCapacityPerSecond * trainLength;

    // Apply multipliers based on vehicle type
    const vehicleHoverMult = vehicleType.isHover ? hoverMultiplier : 1;
    const vehicleHyperloopMult = vehicleType.isHyperloop ? hyperloopMultiplier : 1;

    const finalCapacity =
      baseCapacity *
      universalMultiplier *
      epicMultiplier *
      vehicleHoverMult *
      vehicleHyperloopMult *
      shippingCapMultiplier *
      artifactMultiplier;

    totalBaseCapacity += baseCapacity;
    totalFinalCapacity += finalCapacity;

    return {
      slotIndex: index,
      vehicleId: slot.vehicleId,
      vehicleName: vehicleType.name,
      trainLength,
      baseCapacity,
      universalMultiplier,
      hoverMultiplier: vehicleHoverMult,
      hyperloopMultiplier: vehicleHyperloopMult,
      shippingCapMultiplier,
      artifactMultiplier,
      finalCapacity,
    };
  });

  // Build research breakdown for display
  const researchBreakdown = capacityResearches.map(research => {
    const level = researchLevels[research.id] || 0;
    return {
      researchId: research.id,
      name: research.name,
      description: research.description,
      level,
      maxLevel: research.maxLevel,
      multiplier: calculateResearchMultiplier(research.perLevel, level, research.maxLevel),
      hoverOnly: research.hoverOnly,
      hyperloopOnly: research.hyperloopOnly,
    };
  });

  // Build fleet size research breakdown
  const fleetSizeBreakdown = fleetSizeResearches.map(research => {
    const level = researchLevels[research.id] || 0;
    const clampedLevel = Math.max(0, Math.min(level, research.maxLevel));
    return {
      researchId: research.id,
      name: research.name,
      level: clampedLevel,
      maxLevel: research.maxLevel,
      slotsAdded: clampedLevel * research.perLevel,
    };
  });

  return {
    vehicleBreakdown,
    totalBaseCapacity,
    universalMultiplier,
    epicMultiplier,
    hoverMultiplier,
    hyperloopMultiplier,
    shippingCapMultiplier,
    totalFinalCapacity,
    maxVehicleSlots,
    maxTrainLength,
    researchBreakdown,
    fleetSizeBreakdown,
    artifactMultiplier,
    artifactBreakdown: artifactEffects,
  };
}

/**
 * Get all capacity researches for display/iteration.
 */
export function getCapacityResearches(): ShippingCapacityResearch[] {
  return capacityResearches;
}

/**
 * Get all fleet size researches for display/iteration.
 */
export function getFleetSizeResearches(): FleetSizeResearch[] {
  return fleetSizeResearches;
}

/**
 * Get graviton coupling research info.
 */
export function getGravitonCouplingResearch(): { id: string; name: string; maxLevel: number } | null {
  if (!gravitonCouplingResearch) return null;
  return {
    id: gravitonCouplingResearch.id,
    name: gravitonCouplingResearch.name,
    maxLevel: gravitonCouplingResearch.levels,
  };
}

/**
 * Get all vehicle types.
 */
export function getVehicleTypes() {
  return vehicleTypes;
}
