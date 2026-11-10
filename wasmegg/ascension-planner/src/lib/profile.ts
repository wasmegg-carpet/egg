import type { PlannerProfile } from 'lib/planners/profile';
import { getDiscountedHabPrice } from '@/lib/habs';
import { getDiscountedVehiclePrice, getDiscountedTrainCarPrice } from '@/lib/vehicles';
import { getDiscountedResearchPrice } from '@/calculations/commonResearch';
import { formatPrice } from '@/lib/format';

/** How the ascension planner fills in the parts shared planner code leaves open. */
export const PROFILE: PlannerProfile = {
  currency: { name: 'gems', singular: 'gem', title: 'Gems', waitActionType: 'wait_for_gems', fuelEarningsField: 'gemsEarnedDuringFuel', iconPath: 'egginc/icon_virtue_gem.png', formatPrice: formatPrice },
  missions: { noun: 'virtue mission', activeHeading: 'Active Virtue Missions', showCurrencyBadge: true },
  pricing: {
    hab: getDiscountedHabPrice,
    vehicle: getDiscountedVehiclePrice,
    trainCar: getDiscountedTrainCarPrice,
    research: getDiscountedResearchPrice,
  },
  ihrTruthEggBase: 1.1,
  storagePrefix: 'ascension',
  hasDeliveryViews: true,
  maxVehiclesRoiRoute: 'gone to Kindness and ',
  hasShifts: true,
  appName: 'Ascension Planner',
  planLabel: 'Ascension',
  planFilePrefix: 'ascension',
  missionsWaitEgg: 'humility',
  tanklessFuelEggs: ['humility'],
  setupShowsFuelTank: true,
  researchSaleEgg: 'curiosity',
  baseEggValue: 1,
  fuelEggIconPath: egg => `egginc/egg_${egg}.png`,
};
