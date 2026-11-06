import { defineStore } from 'pinia';

export interface SalesState {
  research: boolean;
  hab: boolean;
  vehicle: boolean;
  earningsBoostActive: boolean;
  earningsBoostMultiplier: number;
}

export const useSalesStore = defineStore('sales', {
  state: (): SalesState => ({
    research: false,
    hab: false,
    vehicle: false,
    earningsBoostActive: false,
    earningsBoostMultiplier: 1,
  }),
  actions: {
    setSaleActive(type: 'research' | 'hab' | 'vehicle', active: boolean) {
      this[type] = active;
    },
    setEarningsBoost(active: boolean, multiplier: number) {
      this.earningsBoostActive = active;
      this.earningsBoostMultiplier = multiplier;
    },
  },
});
