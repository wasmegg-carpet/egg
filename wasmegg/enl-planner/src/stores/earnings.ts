import { defineStore } from 'pinia';
import type { TimeUnit } from '@/types';

export interface EarningsState {
  // Display time unit
  timeUnit: TimeUnit;
}

export const useEarningsStore = defineStore('earnings', {
  state: (): EarningsState => ({
    timeUnit: 'hour',
  }),

  actions: {
    setTimeUnit(unit: TimeUnit) {
      this.timeUnit = unit;
    },
  },
});
