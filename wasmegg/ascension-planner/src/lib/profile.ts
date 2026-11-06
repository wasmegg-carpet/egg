import type { PlannerProfile } from 'lib/planners/profile';
import { formatGemPrice } from '@/lib/format';

/** How the ascension planner fills in the parts shared planner code leaves open. */
export const PROFILE: PlannerProfile = {
  currency: { name: 'gems', iconPath: 'egginc/icon_virtue_gem.png', formatPrice: formatGemPrice },
  missions: { noun: 'virtue mission', activeHeading: 'Active Virtue Missions', showCurrencyBadge: true },
  ihrTruthEggBase: 1.1,
};
