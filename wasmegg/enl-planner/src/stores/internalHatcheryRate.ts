import { defineStore } from 'pinia';
import type { ResearchLevels } from '@/types';
import { getCommonIHRResearches, getEpicIHRResearches } from '@/calculations/internalHatcheryRate';

const commonResearches = getCommonIHRResearches();
const epicResearches = getEpicIHRResearches();

export interface IHRState {
  // Eggs of Truth (0-490)
  te: number;

  // Research levels for common IHR researches
  researchLevels: ResearchLevels;
}

export const useIHRStore = defineStore('internalHatcheryRate', {
  state: (): IHRState => ({
    te: 0,
    researchLevels: initializeResearchLevels(),
  }),

  getters: {
    /**
     * Get all common IHR researches
     */
    commonResearches: () => commonResearches,

    /**
     * Get all epic IHR researches
     */
    epicResearches: () => epicResearches,
  },

  actions: {
    /**
     * Set TE (Eggs of Truth) value (0-490)
     */
    setTE(value: number) {
      this.te = Math.max(0, Math.min(490, Math.round(value)));
    },

    /**
     * Set the level for a specific common research
     */
    setResearchLevel(researchId: string, level: number) {
      const research = commonResearches.find(r => r.id === researchId);
      if (research) {
        this.researchLevels[researchId] = Math.max(0, Math.min(level, research.maxLevel));
      }
    },

    /**
     * Increment common research level by 1
     */
    incrementResearch(researchId: string) {
      const research = commonResearches.find(r => r.id === researchId);
      if (research) {
        const current = this.researchLevels[researchId] || 0;
        this.researchLevels[researchId] = Math.min(current + 1, research.maxLevel);
      }
    },

    /**
     * Decrement common research level by 1
     */
    decrementResearch(researchId: string) {
      const current = this.researchLevels[researchId] || 0;
      this.researchLevels[researchId] = Math.max(current - 1, 0);
    },

    /**
     * Set all common researches to max level
     */
    maxAllResearch() {
      for (const research of commonResearches) {
        this.researchLevels[research.id] = research.maxLevel;
      }
    },

    /**
     * Reset all common researches to 0
     */
    resetAllResearch() {
      for (const research of commonResearches) {
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
  for (const research of commonResearches) {
    levels[research.id] = 0;
  }
  return levels;
}
