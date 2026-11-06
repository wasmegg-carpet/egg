import type { PlannerProfile } from 'lib/planners/profile';
import { getDiscountedHabPrice } from '@/lib/habs';
import { getDiscountedVehiclePrice, getDiscountedTrainCarPrice } from '@/lib/vehicles';
import { getDiscountedVirtuePrice } from '@/calculations/commonResearch';
import { formatGemPrice } from '@/lib/format';

/** How the ascension planner fills in the parts shared planner code leaves open. */
export const PROFILE: PlannerProfile = {
  currency: { name: 'gems', iconPath: 'egginc/icon_virtue_gem.png', formatPrice: formatGemPrice },
  missions: { noun: 'virtue mission', activeHeading: 'Active Virtue Missions', showCurrencyBadge: true },
  pricing: {
    hab: getDiscountedHabPrice,
    vehicle: getDiscountedVehiclePrice,
    trainCar: getDiscountedTrainCarPrice,
    research: getDiscountedVirtuePrice,
  },
  ihrTruthEggBase: 1.1,
};
