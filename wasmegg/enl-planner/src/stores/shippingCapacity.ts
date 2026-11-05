import { defineStore } from 'pinia';
import type { ResearchLevels, VehicleSlot, TimeUnit } from '@/types';
import {
  getCapacityResearches,
  getFleetSizeResearches,
  getGravitonCouplingResearch,
  calculateMaxVehicleSlots,
  calculateMaxTrainLength,
} from '@/calculations/shippingCapacity';
import { BASE_FLEET_SIZE } from '@/lib/vehicles';

const capacityResearches = getCapacityResearches();
const fleetSizeResearches = getFleetSizeResearches();
const gravitonCouplingResearch = getGravitonCouplingResearch();

export interface ShippingCapacityState {
  // Vehicle slots (dynamically sized based on fleet research)
  vehicles: VehicleSlot[];

  // Research levels for capacity multipliers
  researchLevels: ResearchLevels;

  // Display time unit (default: hour)
  timeUnit: TimeUnit;
}

export const useShippingCapacityStore = defineStore('shippingCapacity', {
  state: (): ShippingCapacityState => ({
    vehicles: initializeVehicles(),
    researchLevels: initializeResearchLevels(),
    timeUnit: 'hour',
  }),

  getters: {
    capacityResearches: () => capacityResearches,
    fleetSizeResearches: () => fleetSizeResearches,
    gravitonCouplingResearch: () => gravitonCouplingResearch,

    /**
     * Max vehicle slots based on current research
     */
    maxVehicleSlots(): number {
      return calculateMaxVehicleSlots(this.researchLevels);
    },

    /**
     * Max train length based on graviton coupling research
     */
    maxTrainLength(): number {
      return calculateMaxTrainLength(this.researchLevels);
    },
  },

  actions: {
    /**
     * Set vehicle in a slot
     */
    setVehicle(slotIndex: number, vehicleId: number | null) {
      if (slotIndex < 0) return;
      // Extend vehicles array if needed (for slots unlocked by fleet research)
      while (this.vehicles.length <= slotIndex) {
        this.vehicles.push({ vehicleId: null, trainLength: 1 });
      }
      this.vehicles[slotIndex] = {
        vehicleId,
        trainLength: vehicleId === 11 ? 1 : 1, // Default train length of 1
      };
    },

    /**
     * Set train length for a hyperloop vehicle
     * Note: Max length validation is done by the UI using commonResearchStore,
     * not this store's researchLevels (which aren't updated when research is bought).
     */
    setTrainLength(slotIndex: number, length: number) {
      if (slotIndex < 0) return;
      // Extend vehicles array if needed (for slots unlocked by fleet research)
      while (this.vehicles.length <= slotIndex) {
        this.vehicles.push({ vehicleId: null, trainLength: 1 });
      }
      this.vehicles[slotIndex].trainLength = Math.max(1, length);
    },

    /**
     * Add a car to a hyperloop train
     */
    addTrainCar(slotIndex: number) {
      if (slotIndex >= 0 && slotIndex < this.vehicles.length) {
        const current = this.vehicles[slotIndex].trainLength;
        this.setTrainLength(slotIndex, current + 1);
      }
    },

    /**
     * Remove a car from a hyperloop train
     */
    removeTrainCar(slotIndex: number) {
      if (slotIndex >= 0 && slotIndex < this.vehicles.length) {
        const current = this.vehicles[slotIndex].trainLength;
        this.setTrainLength(slotIndex, current - 1);
      }
    },

    /**
     * Set research level for capacity research
     */
    setResearchLevel(researchId: string, level: number) {
      const research = capacityResearches.find(r => r.id === researchId);
      if (research) {
        this.researchLevels[researchId] = Math.max(0, Math.min(level, research.maxLevel));
      }
    },

    /**
     * Set research level for fleet size research
     */
    setFleetSizeResearchLevel(researchId: string, level: number) {
      const research = fleetSizeResearches.find(r => r.id === researchId);
      if (research) {
        this.researchLevels[researchId] = Math.max(0, Math.min(level, research.maxLevel));
        // Resize vehicles array if needed
        this.resizeVehicleSlots();
      }
    },

    /**
     * Set graviton coupling research level
     */
    setGravitonCouplingLevel(level: number) {
      if (gravitonCouplingResearch) {
        this.researchLevels[gravitonCouplingResearch.id] = Math.max(
          0,
          Math.min(level, gravitonCouplingResearch.maxLevel)
        );
        // Clamp existing train lengths to new max
        const maxLength = this.maxTrainLength;
        for (const vehicle of this.vehicles) {
          if (vehicle.trainLength > maxLength) {
            vehicle.trainLength = maxLength;
          }
        }
      }
    },

    /**
     * Resize vehicle slots array based on fleet size research
     */
    resizeVehicleSlots() {
      const maxSlots = this.maxVehicleSlots;
      while (this.vehicles.length < maxSlots) {
        this.vehicles.push({ vehicleId: null, trainLength: 1 });
      }
      // Don't shrink - keep existing vehicles even if research decreases
    },

    /**
     * Increment capacity research by 1
     */
    incrementResearch(researchId: string) {
      const research = capacityResearches.find(r => r.id === researchId);
      if (research) {
        const current = this.researchLevels[researchId] || 0;
        this.researchLevels[researchId] = Math.min(current + 1, research.maxLevel);
      }
    },

    /**
     * Decrement capacity research by 1
     */
    decrementResearch(researchId: string) {
      const current = this.researchLevels[researchId] || 0;
      this.researchLevels[researchId] = Math.max(current - 1, 0);
    },

    /**
     * Max all shipping research (capacity, fleet size, graviton coupling)
     */
    maxAllResearch() {
      for (const research of capacityResearches) {
        this.researchLevels[research.id] = research.maxLevel;
      }
      for (const research of fleetSizeResearches) {
        this.researchLevels[research.id] = research.maxLevel;
      }
      if (gravitonCouplingResearch) {
        this.researchLevels[gravitonCouplingResearch.id] = gravitonCouplingResearch.maxLevel;
      }
      // Resize vehicles array for new fleet size
      this.resizeVehicleSlots();
    },

    /**
     * Reset all shipping research to 0 (capacity, fleet size, graviton coupling)
     */
    resetAllResearch() {
      for (const research of capacityResearches) {
        this.researchLevels[research.id] = 0;
      }
      for (const research of fleetSizeResearches) {
        this.researchLevels[research.id] = 0;
      }
      if (gravitonCouplingResearch) {
        this.researchLevels[gravitonCouplingResearch.id] = 0;
      }
      // Clamp train lengths to new max (which is now 5)
      const maxLength = this.maxTrainLength;
      for (const vehicle of this.vehicles) {
        if (vehicle.trainLength > maxLength) {
          vehicle.trainLength = maxLength;
        }
      }
    },

    /**
     * Set time unit for display
     */
    setTimeUnit(unit: TimeUnit) {
      this.timeUnit = unit;
    },
  },
});

/**
 * Initialize vehicle slots with default fleet size (1 Trike + 3 empty slots)
 */
function initializeVehicles(): VehicleSlot[] {
  const vehicles: VehicleSlot[] = [];
  // First slot has a Trike by default
  vehicles.push({ vehicleId: 0, trainLength: 1 });
  // Remaining slots are empty
  for (let i = 1; i < BASE_FLEET_SIZE; i++) {
    vehicles.push({ vehicleId: null, trainLength: 1 });
  }
  return vehicles;
}

/**
 * Initialize research levels with all at 0
 */
function initializeResearchLevels(): ResearchLevels {
  const levels: ResearchLevels = {};
  for (const research of capacityResearches) {
    levels[research.id] = 0;
  }
  for (const research of fleetSizeResearches) {
    levels[research.id] = 0;
  }
  if (gravitonCouplingResearch) {
    levels[gravitonCouplingResearch.id] = 0;
  }
  return levels;
}
