import { defineStore } from 'pinia';
import type { ResearchLevels, Research } from '@/types';
import { allResearches } from 'lib';

// Filter to only egg value researches
const eggValueResearches = (allResearches as Research[]).filter(r => r.categories.split(',').includes('egg_value'));

export interface EggValueState {
  // Base egg value (1 gem for virtue eggs)
  baseValue: number;

  // Research levels for egg value researches
  researchLevels: ResearchLevels;
}

export const useEggValueStore = defineStore('eggValue', {
  state: (): EggValueState => ({
    baseValue: 1,
    researchLevels: initializeResearchLevels(),
  }),

  getters: {
    /**
     * Get all egg value researches with their current levels
     */
    eggValueResearches: () => eggValueResearches,

    /**
     * Get a specific research by ID
     */
    getResearch: () => (id: string) => {
      return eggValueResearches.find(r => r.id === id);
    },
  },

  actions: {
    /**
     * Set the level for a specific research
     */
    setResearchLevel(researchId: string, level: number) {
      const research = eggValueResearches.find(r => r.id === researchId);
      if (research) {
        this.researchLevels[researchId] = Math.max(0, Math.min(level, research.levels));
      }
    },

    /**
     * Increment research level by 1
     */
    incrementResearch(researchId: string) {
      const research = eggValueResearches.find(r => r.id === researchId);
      if (research) {
        const current = this.researchLevels[researchId] || 0;
        this.researchLevels[researchId] = Math.min(current + 1, research.levels);
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
      for (const research of eggValueResearches) {
        this.researchLevels[research.id] = research.levels;
      }
    },

    /**
     * Reset all researches to 0
     */
    resetAllResearch() {
      for (const research of eggValueResearches) {
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
  for (const research of eggValueResearches) {
    levels[research.id] = 0;
  }
  return levels;
}
