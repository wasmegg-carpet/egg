import {
  type CommonResearch,
  getCommonResearches,
  getDiscountedVirtuePrice,
  isTierUnlocked,
  type ResearchCostModifiers,
} from './commonResearch';
import type { CalculationsSnapshot } from '@/types';
import { getTimeToSave } from '@/engine/apply';
import { getSaleAwareTimeToSave } from './researchROI';

export interface SmartBuyCandidate {
  research: CommonResearch;
  price: number;
  secondsToSave: number;
}

/**
 * Cheapest unpurchased, unlocked research level that can be saved up for in
 * `<= thresholdSeconds` of pure earning time (existing bank/gems are ignored — see
 * `ResearchActions.vue`'s "Smart Buy will never spend gems from your bank" note).
 *
 * `currentAbsoluteTime` is optional and controls sale-awareness: pass it only if the caller will
 * actually simulate the resulting `secondsToSave` wait before buying (e.g. the auto planner's
 * `runSmartBuyForSeconds`, which advances time then buys) — in that case, a candidate that's only
 * affordable once an upcoming sale starts can win if that's faster than buying at today's price
 * (see `getSaleAwareTimeToSave`). Omit it for callers that buy instantly with no simulated wait
 * (the manual planner's Smart Buy button never advances time — it just buys whatever's already
 * cheap right now, and naturally re-considers once a real sale actually starts): considering an
 * upcoming sale there would pick a candidate priced on an assumption `buyOneLevel` won't honor,
 * since it always charges today's real price.
 */
export function findSmartBuyCandidate(
  researchLevels: Record<string, number>,
  mods: ResearchCostModifiers,
  isSale: boolean,
  snapshot: CalculationsSnapshot,
  thresholdSeconds: number,
  currentAbsoluteTime?: number
): SmartBuyCandidate | null {
  if (snapshot.offlineEarnings <= 0) return null;

  // Ignore bank so smart buy never factors in saved gems.
  const noBankSnapshot = { ...snapshot, bankValue: 0 };

  const candidates = getCommonResearches()
    .filter(r => {
      const level = researchLevels[r.id] || 0;
      return level < r.levels && isTierUnlocked(researchLevels, r.tier);
    })
    .map(r => {
      const level = researchLevels[r.id] || 0;
      if (currentAbsoluteTime !== undefined) {
        const purchase = getSaleAwareTimeToSave(r, level, mods, isSale, currentAbsoluteTime, noBankSnapshot, []);
        return { research: r, price: purchase.price, secondsToSave: purchase.waitSeconds };
      }
      const price = getDiscountedVirtuePrice(r, level, mods, isSale);
      return { research: r, price, secondsToSave: getTimeToSave(price, noBankSnapshot) };
    });

  candidates.sort((a, b) => a.price - b.price);

  return candidates.find(c => c.secondsToSave <= thresholdSeconds) ?? null;
}
