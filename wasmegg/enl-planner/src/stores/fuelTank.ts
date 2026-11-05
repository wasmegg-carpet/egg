/**
 * Fuel Tank Store
 *
 * Manages fuel tank state during ascension planning.
 * Tank stores eggs for space missions. Virtue eggs can be stored in the virtue tank.
 * Total eggs across all types cannot exceed tank capacity.
 */

import { defineStore } from 'pinia';
import type { VirtueEgg } from '@/types';

// Tank capacities by level (0-7)
export const TANK_CAPACITIES = [2e9, 200e9, 10e12, 100e12, 200e12, 300e12, 400e12, 500e12];

// Order of virtue eggs in tankFuels array (indices 20-24)
export const VIRTUE_FUEL_ORDER: VirtueEgg[] = ['curiosity', 'integrity', 'humility', 'resilience', 'kindness'];

export interface FuelTankState {
  // Tank level (0-7) - determines max capacity
  tankLevel: number;

  // Stored fuel amounts per virtue egg type
  fuelAmounts: Record<VirtueEgg, number>;
}

function createEmptyFuelAmounts(): Record<VirtueEgg, number> {
  return {
    curiosity: 0,
    integrity: 0,
    humility: 0,
    resilience: 0,
    kindness: 0,
  };
}

export const useFuelTankStore = defineStore('fuelTank', {
  state: (): FuelTankState => ({
    tankLevel: 0,
    fuelAmounts: createEmptyFuelAmounts(),
  }),

  getters: {
    /**
     * Maximum tank capacity based on tank level
     */
    tankCapacity(): number {
      const level = Math.max(0, Math.min(7, this.tankLevel));
      return TANK_CAPACITIES[level];
    },

    /**
     * Total fuel stored across all egg types
     */
    totalFuel(): number {
      return Object.values(this.fuelAmounts).reduce((sum, amt) => sum + amt, 0);
    },

    /**
     * Remaining capacity in the tank
     */
    availableCapacity(): number {
      return Math.max(0, this.tankCapacity - this.totalFuel);
    },

    /**
     * Whether the tank is full
     */
    isFull(): boolean {
      return this.totalFuel >= this.tankCapacity;
    },

    /**
     * Fill percentage (0-100)
     */
    fillPercent(): number {
      if (this.tankCapacity === 0) return 0;
      return Math.min(100, (this.totalFuel / this.tankCapacity) * 100);
    },
  },

  actions: {
    /**
     * Set the tank level (0-7)
     */
    setTankLevel(level: number) {
      this.tankLevel = Math.max(0, Math.min(7, level));
    },

    /**
     * Set fuel amount for a specific egg type
     */
    setFuelAmount(egg: VirtueEgg, amount: number) {
      this.fuelAmounts[egg] = Math.max(0, amount);
    },

    /**
     * Add fuel for a specific egg type.
     * Returns true if successful, false if would exceed capacity.
     */
    addFuel(egg: VirtueEgg, amount: number): boolean {
      const newTotal = this.totalFuel + amount;
      if (newTotal > this.tankCapacity) {
        return false;
      }
      this.fuelAmounts[egg] += amount;
      return true;
    },

    /**
     * Remove fuel for a specific egg type.
     */
    removeFuel(egg: VirtueEgg, amount: number) {
      this.fuelAmounts[egg] = Math.max(0, this.fuelAmounts[egg] - amount);
    },

    /**
     * Reset to empty state
     */
    reset() {
      this.tankLevel = 0;
      this.fuelAmounts = createEmptyFuelAmounts();
    },
  },
});

/**
 * Calculate time to store X eggs at a given lay rate.
 * @param eggs - Number of eggs to store
 * @param layRatePerSecond - Lay rate in eggs per second (at max habs)
 * @returns Time in seconds
 */
export function timeToStore(eggs: number, layRatePerSecond: number): number {
  if (layRatePerSecond <= 0) return Infinity;
  return eggs / layRatePerSecond;
}
