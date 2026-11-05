/**
 * Store for managing common research levels.
 */

import { defineStore } from 'pinia';
import type { ResearchLevels } from '@/types';
import {
  getCommonResearches,
  getResearchByTier,
  getResearchById,
  type CommonResearch,
} from '@/calculations/commonResearch';

export interface CommonResearchStoreState {
  researchLevels: ResearchLevels;
}

function initializeResearchLevels(): ResearchLevels {
  const levels: ResearchLevels = {};
  for (const research of getCommonResearches()) {
    levels[research.id] = 0;
  }
  return levels;
}

export const useCommonResearchStore = defineStore('commonResearch', {
  state: (): CommonResearchStoreState => ({
    researchLevels: initializeResearchLevels(),
  }),

  getters: {
    /**
     * Get the current level of a specific research
     */
    getLevel:
      state =>
      (researchId: string): number => {
        return state.researchLevels[researchId] || 0;
      },

    /**
     * Get total purchases across all research
     */
    totalPurchases(): number {
      return Object.values(this.researchLevels).reduce((sum, level) => sum + level, 0);
    },
  },

  actions: {
    /**
     * Set the level of a specific research
     */
    setResearchLevel(researchId: string, level: number) {
      const research = getResearchById(researchId);
      if (research) {
        this.researchLevels[researchId] = Math.max(0, Math.min(level, research.levels));
      }
    },

    /**
     * Increment research by 1 level
     */
    incrementResearch(researchId: string) {
      const research = getResearchById(researchId);
      if (research) {
        const currentLevel = this.researchLevels[researchId] || 0;
        if (currentLevel < research.levels) {
          this.researchLevels[researchId] = currentLevel + 1;
        }
      }
    },

    /**
     * Decrement research by 1 level
     */
    decrementResearch(researchId: string) {
      const currentLevel = this.researchLevels[researchId] || 0;
      if (currentLevel > 0) {
        this.researchLevels[researchId] = currentLevel - 1;
      }
    },

    /**
     * Max out a specific research
     */
    maxResearch(researchId: string) {
      const research = getResearchById(researchId);
      if (research) {
        this.researchLevels[researchId] = research.levels;
      }
    },

    /**
     * Reset a specific research to 0
     */
    resetResearch(researchId: string) {
      if (researchId in this.researchLevels) {
        this.researchLevels[researchId] = 0;
      }
    },

    /**
     * Max out all research in a tier
     */
    maxTier(tier: number) {
      const tierResearches = getResearchByTier().get(tier) || [];
      for (const research of tierResearches) {
        this.researchLevels[research.id] = research.levels;
      }
    },

    /**
     * Reset all research in a tier
     */
    resetTier(tier: number) {
      const tierResearches = getResearchByTier().get(tier) || [];
      for (const research of tierResearches) {
        this.researchLevels[research.id] = 0;
      }
    },

    /**
     * Max out all common research
     */
    maxAll() {
      for (const research of getCommonResearches()) {
        this.researchLevels[research.id] = research.levels;
      }
    },

    /**
     * Reset all common research
     */
    resetAll() {
      this.researchLevels = initializeResearchLevels();
    },
  },
});
