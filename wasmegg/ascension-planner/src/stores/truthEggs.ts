/**
 * Truth Eggs Store
 *
 * Manages TE (Truth Eggs / Eggs of Truth / Eggs of Virtue) state during ascension planning.
 * Each virtue egg can have 0-98 TE earned. Max total TE: 490.
 *
 * TE are earned by shipping eggs during an ascension. Claimed TE affect earnings and IHR
 * via a 1.1^TE multiplier. Pending TE are earned by shipping eggs but only claimed at
 * ascension end.
 */

import { defineStore } from 'pinia';
import type { VirtueEgg } from '@/types';
import {
  countTEThresholdsPassed,
  pendingTruthEggs,
  nextTEThreshold,
  getThresholdForTE,
  eggsNeededForTE,
  MAX_TE,
  MAX_TOTAL_TE,
} from '@/lib/truthEggs';

// Order of virtue eggs (matches backup virtue.eggsDelivered and virtue.eovEarned indices 0-4)
export const VIRTUE_TE_ORDER: VirtueEgg[] = ['curiosity', 'integrity', 'humility', 'resilience', 'kindness'];

export interface TruthEggsState {
  // Per-egg lifetime eggs delivered (from backup, editable)
  eggsDelivered: Record<VirtueEgg, number>;
  // Per-egg claimed TE (from backup, editable)
  teEarned: Record<VirtueEgg, number>;
}

function createEmptyEggsDelivered(): Record<VirtueEgg, number> {
  return {
    curiosity: 0,
    integrity: 0,
    humility: 0,
    resilience: 0,
    kindness: 0,
  };
}

function createEmptyTEEarned(): Record<VirtueEgg, number> {
  return {
    curiosity: 0,
    integrity: 0,
    humility: 0,
    resilience: 0,
    kindness: 0,
  };
}

export const useTruthEggsStore = defineStore('truthEggs', {
  state: (): TruthEggsState => ({
    eggsDelivered: createEmptyEggsDelivered(),
    teEarned: createEmptyTEEarned(),
  }),

  getters: {
    /**
     * Total TE earned across all eggs (0-490)
     */
    totalTE(): number {
      return Object.values(this.teEarned).reduce((sum, te) => sum + te, 0);
    },

    /**
     * Whether there are any pending TE across all eggs
     */
    hasPendingTE(): boolean {
      return this.totalPendingTE > 0;
    },

    /**
     * Pending TE for a specific egg (thresholds passed but not yet claimed)
     */
    pendingTEForEgg(): (egg: VirtueEgg) => number {
      return (egg: VirtueEgg) => {
        return pendingTruthEggs(this.eggsDelivered[egg], this.teEarned[egg]);
      };
    },

    /**
     * Total pending TE across all eggs
     */
    totalPendingTE(): number {
      return VIRTUE_TE_ORDER.reduce(
        (sum, egg) => sum + pendingTruthEggs(this.eggsDelivered[egg], this.teEarned[egg]),
        0
      );
    },

    /**
     * Eggs needed to reach the next TE threshold for a specific egg
     */
    eggsToNextTE(): (egg: VirtueEgg) => number {
      return (egg: VirtueEgg) => {
        const current = this.eggsDelivered[egg];
        const nextThreshold = nextTEThreshold(current);
        if (nextThreshold === Infinity) return 0;
        return nextThreshold - current;
      };
    },

    /**
     * Next TE number that will be earned for a specific egg
     */
    nextTENumber(): (egg: VirtueEgg) => number {
      return (egg: VirtueEgg) => {
        const currentTE = countTEThresholdsPassed(this.eggsDelivered[egg]);
        return currentTE < MAX_TE ? currentTE + 1 : MAX_TE;
      };
    },

    /**
     * Current TE count (thresholds passed) for a specific egg based on eggs delivered
     */
    currentTEForEgg(): (egg: VirtueEgg) => number {
      return (egg: VirtueEgg) => {
        return countTEThresholdsPassed(this.eggsDelivered[egg]);
      };
    },
  },

  actions: {
    /**
     * Set eggs delivered for a specific egg.
     * Does NOT auto-sync teEarned - use setEggsDeliveredWithSync for that.
     */
    setEggsDelivered(egg: VirtueEgg, amount: number) {
      this.eggsDelivered[egg] = Math.max(0, amount);
    },

    /**
     * Set eggs delivered and auto-sync TE earned to match thresholds.
     * Use this when the user edits eggs delivered in the UI.
     */
    setEggsDeliveredWithSync(egg: VirtueEgg, amount: number) {
      this.eggsDelivered[egg] = Math.max(0, amount);
      // Auto-calculate correct TE based on thresholds
      const correctTE = countTEThresholdsPassed(amount);
      this.teEarned[egg] = correctTE;
    },

    /**
     * Set TE earned for a specific egg.
     * Does NOT auto-sync eggsDelivered - use setTEEarnedWithSync for that.
     */
    setTEEarned(egg: VirtueEgg, count: number) {
      this.teEarned[egg] = Math.max(0, Math.min(MAX_TE, count));
    },

    /**
     * Set TE earned and auto-sync eggs delivered to minimum for that threshold.
     * Use this when the user edits TE earned in the UI.
     */
    setTEEarnedWithSync(egg: VirtueEgg, count: number) {
      const clampedTE = Math.max(0, Math.min(MAX_TE, count));
      this.teEarned[egg] = clampedTE;
      // Set eggs delivered to minimum for this threshold
      const minEggs = getThresholdForTE(clampedTE);
      this.eggsDelivered[egg] = minEggs;
    },

    /**
     * Add eggs delivered for a specific egg (for wait_for_te action).
     * Returns the number of new TE thresholds crossed.
     */
    addEggsDelivered(egg: VirtueEgg, amount: number): number {
      const beforeTE = countTEThresholdsPassed(this.eggsDelivered[egg]);
      this.eggsDelivered[egg] += amount;
      const afterTE = countTEThresholdsPassed(this.eggsDelivered[egg]);
      return afterTE - beforeTE;
    },

    /**
     * Get eggs needed to reach a target TE from current state for an egg.
     */
    getEggsNeededForTE(egg: VirtueEgg, targetTE: number): number {
      return eggsNeededForTE(this.eggsDelivered[egg], targetTE);
    },

    hydrate(data: { initialEggsDelivered?: Record<VirtueEgg, number>; initialTeEarned?: Record<VirtueEgg, number> } | null | undefined) {
      if (!data) return;
      if (data.initialEggsDelivered) this.eggsDelivered = { ...data.initialEggsDelivered };
      if (data.initialTeEarned) this.teEarned = { ...data.initialTeEarned };
    },
    /**
     * Reset to empty state
     */
    reset() {
      this.eggsDelivered = createEmptyEggsDelivered();
      this.teEarned = createEmptyTEEarned();
    },
  },
});

// Re-export constants for convenience
export { MAX_TE, MAX_TOTAL_TE };
