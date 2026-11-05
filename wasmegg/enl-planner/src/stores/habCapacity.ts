import { defineStore } from 'pinia';
import type { ResearchLevels } from '@/types';
import { getHabCapacityResearches, type HabCapacityResearch } from '@/calculations/habCapacity';
import { habTypes, type HabId } from '@/lib/habs';

const habCapacityResearches = getHabCapacityResearches();

export interface HabCapacityState {
  // Array of 4 hab slots (null = empty slot, number = hab ID)
  // Initially: one Shack (id=1) purchased, 3 empty slots
  habIds: (HabId | null)[];

  // Research levels for hab capacity researches
  researchLevels: ResearchLevels;
}

export const useHabCapacityStore = defineStore('habCapacity', {
  state: (): HabCapacityState => ({
    habIds: [0, null, null, null], // Start with one Coop
    researchLevels: initializeResearchLevels(),
  }),

  getters: {
    /**
     * Get all hab capacity researches
     */
    habCapacityResearches: () => habCapacityResearches,

    /**
     * Get number of purchased habs
     */
    purchasedHabCount(state): number {
      return state.habIds.filter(id => id !== null).length;
    },

    /**
     * Get all available hab types
     */
    availableHabs: () => habTypes,
  },

  actions: {
    /**
     * Set the hab for a specific slot
     */
    setHab(slotIndex: number, habId: HabId | null) {
      if (slotIndex >= 0 && slotIndex < 4) {
        this.habIds[slotIndex] = habId;
      }
    },

    /**
     * Add a new hab to the first empty slot
     */
    addHab(habId: HabId) {
      const emptySlot = this.habIds.findIndex(id => id === null);
      if (emptySlot !== -1) {
        this.habIds[emptySlot] = habId;
      }
    },

    /**
     * Remove hab from a slot (set to null)
     */
    removeHab(slotIndex: number) {
      if (slotIndex >= 0 && slotIndex < 4) {
        this.habIds[slotIndex] = null;
      }
    },

    /**
     * Set the level for a specific research
     */
    setResearchLevel(researchId: string, level: number) {
      const research = habCapacityResearches.find(r => r.id === researchId);
      if (research) {
        this.researchLevels[researchId] = Math.max(0, Math.min(level, research.maxLevel));
      }
    },

    incrementResearchLevel(researchId: string) {
      const current = this.researchLevels[researchId] || 0;
      const research = getHabCapacityResearches().find(r => r.id === researchId);
      if (research) {
        this.researchLevels[researchId] = Math.min(current + 1, research.maxLevel);
      }
    },

    /**
     * Decrement research level by 1
     */
    decrementResearch(researchId: string) {
      const current = this.researchLevels[researchId] || 0;
      this.researchLevels[researchId] = Math.max(current - 1, 0);
    },

    /**
     * Set all researches to max level
     */
    maxAllResearch() {
      for (const research of getHabCapacityResearches()) {
        this.researchLevels[research.id] = research.maxLevel;
      }
    },

    /**
     * Reset all researches to 0
     */
    resetAllResearch() {
      for (const research of habCapacityResearches) {
        this.researchLevels[research.id] = 0;
      }
    },
  },
});

/**
 * Initialize research levels with all at 0
 */
function initializeResearchLevels(): ResearchLevels {
  const levels: ResearchLevels = {};
  for (const research of habCapacityResearches) {
    levels[research.id] = 0;
  }
  return levels;
}
