import type { PlannerProfile } from 'lib/planners/profile';
import { formatBockPrice } from '@/lib/format';

/** How the enlightenment planner fills in the parts shared planner code leaves open. */
export const PROFILE: PlannerProfile = {
  currency: { name: 'bocks', iconPath: 'egginc/icon_bock.png', formatPrice: formatBockPrice },
  missions: { noun: 'mission', activeHeading: 'Active Missions', showCurrencyBadge: false },
  // 1.01^TE on an enlightenment farm
  ihrTruthEggBase: 1.01,
};
