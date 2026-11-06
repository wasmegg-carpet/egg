/**
 * Store for managing silo count during ascension planning.
 *
 * Silos provide offline/away time:
 * - Everyone starts with 1 silo for free
 * - Max 10 silos with Pro permit, 2 with Standard
 * - Each silo provides 60 + (siloCapacityLevel * 6) minutes of away time
 * - Silo Capacity epic research maxes at level 20 (180 min / 3 hours per silo)
 */

import { defineStore } from 'pinia';
import { useInitialStateStore } from './initialState';
import type { SilosState } from 'lib/planners/silos';
import { MIN_SILOS, MAX_SILOS, maxSilos } from 'lib/planners/silos';
export type { SilosState } from 'lib/planners/silos';
export {
  MIN_SILOS,
  MAX_SILOS,
  MAX_SILOS_STANDARD_PERMIT,
  BASE_MINUTES_PER_SILO,
  MINUTES_PER_SILO_CAPACITY_LEVEL,
  MAX_SILO_CAPACITY_LEVEL,
  maxSilos,
  nextSiloCost,
  awayTimePerSilo,
  totalAwayTime,
  formatSiloTime,
} from 'lib/planners/silos';

export const useSilosStore = defineStore('silos', {
  state: (): SilosState => ({
    siloCount: MIN_SILOS, // Everyone starts with 1 silo
  }),

  getters: {
    /**
     * Check if we can buy more silos.
     */
    canBuySilo(): boolean {
      return this.siloCount < maxSilos(useInitialStateStore().proPermit);
    },

    /**
     * Get the number of silos that have been purchased (beyond the free one).
     */
    purchasedSilos(): number {
      return Math.max(0, this.siloCount - MIN_SILOS);
    },
  },

  actions: {
    /**
     * Set the silo count directly.
     */
    setSiloCount(count: number) {
      // Not capped by permit: this mirrors replayed plans and snapshots, which already respect it.
      this.siloCount = Math.max(MIN_SILOS, Math.min(MAX_SILOS, count));
    },

    /**
     * Buy one silo if possible.
     */
    buySilo(): boolean {
      if (this.siloCount >= maxSilos(useInitialStateStore().proPermit)) {
        return false;
      }
      this.siloCount++;
      return true;
    },

    /**
     * Reset to initial state (1 silo).
     */
    reset() {
      this.siloCount = MIN_SILOS;
    },
  },
});
