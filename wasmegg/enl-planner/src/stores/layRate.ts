import { defineStore } from 'pinia';
import type { ResearchLevels, TimeUnit } from '@/types';
import { getCommonLayRateResearches } from '@/calculations/layRate';

const commonResearches = getCommonLayRateResearches();

export interface LayRateState {
  // Research levels for common lay rate researches
  researchLevels: ResearchLevels;

  // Display time unit (default: hour)
  timeUnit: TimeUnit;
}

export const useLayRateStore = defineStore('layRate', {
  state: (): LayRateState => ({
    researchLevels: initializeResearchLevels(),
    timeUnit: 'hour',
  }),

  getters: {
    /**
     * Get all common lay rate researches
     */
    commonResearches: () => commonResearches,
  },

  actions: {
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

    /**
     * Set time unit for display
     */
    setTimeUnit(unit: TimeUnit) {
      this.timeUnit = unit;
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
