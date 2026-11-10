import { ENLIGHTENMENT_EGG_VALUE } from '@/calculations/eggValue';
import { fuelEggIconPath } from '@/lib/missions';
import type { FuelEgg } from '@/types';
import { researchCubeOverride } from '@/lib/artifacts/researchCube';
import { useInitialStateStore } from '@/stores/initialState';
import type { PlannerProfile } from 'lib/planners/profile';
import { getDiscountedHabPrice } from '@/lib/habs';
import { getDiscountedVehiclePrice, getDiscountedTrainCarPrice } from '@/lib/vehicles';
import { getDiscountedResearchPrice } from '@/calculations/commonResearch';
import { formatPrice } from '@/lib/format';

/** How the enlightenment planner fills in the parts shared planner code leaves open. */
export const PROFILE: PlannerProfile = {
  currency: { name: 'bocks', singular: 'bock', title: 'Bocks', waitActionType: 'wait_for_cash', fuelEarningsField: 'cashEarnedDuringFuel', iconPath: 'egginc/icon_bock.png', formatPrice: formatPrice },
  missions: { noun: 'mission', activeHeading: 'Active Missions', showCurrencyBadge: false },
  pricing: {
    hab: getDiscountedHabPrice,
    vehicle: getDiscountedVehiclePrice,
    trainCar: getDiscountedTrainCarPrice,
    research: getDiscountedResearchPrice,
  },
  // 1.01^TE on an enlightenment farm
  ihrTruthEggBase: 1.01,
  storagePrefix: 'enl',
  hasDeliveryViews: false,
  maxVehiclesRoiRoute: '',
  hasShifts: false,
  appName: 'Enlightenment Planner',
  planLabel: 'Plan',
  planFilePrefix: 'enlightenment',
  missionsWaitEgg: null,
  tanklessFuelEggs: [],
  // Setup only has the tank level; the amounts are edited under Rockets > Fuel.
  setupShowsFuelTank: false,
  researchSaleEgg: null,
  baseEggValue: ENLIGHTENMENT_EGG_VALUE,
  fuelEggIconPath: egg => fuelEggIconPath(egg as FuelEgg),
  researchCubeMultiplier: () => researchCubeOverride(useInitialStateStore().researchCube),
};
