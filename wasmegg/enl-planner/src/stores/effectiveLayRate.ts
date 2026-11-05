import { defineStore } from 'pinia';
import type { TimeUnit } from '@/types';

export interface EffectiveLayRateState {
  timeUnit: TimeUnit;
}

export const useEffectiveLayRateStore = defineStore('effectiveLayRate', {
  state: (): EffectiveLayRateState => ({
    timeUnit: 'hour',
  }),

  actions: {
    setTimeUnit(unit: TimeUnit) {
      this.timeUnit = unit;
    },
  },
});
