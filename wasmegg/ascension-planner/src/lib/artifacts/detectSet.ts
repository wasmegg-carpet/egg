import { getArtifact } from './data';
import type { EquippedArtifact } from './types';

const EARNINGS_STONE_PREFIXES = ['lunar-stone-', 'terra-stone-', 'shell-stone-'];
const DELIVERY_STONE_PREFIXES = ['quantum-stone-', 'tachyon-stone-'];

/**
 * Which set a loadout is, judged by its stones: all lunar/terra/shell is the earnings set, all
 * quantum/tachyon the delivery (ELR) set. Null when it can't tell: fewer than 3 stone slots, no stones,
 * or a mix of both kinds.
 */
export function detectArtifactSet(loadout: EquippedArtifact[]): 'earnings' | 'elr' | null {
  let totalSlots = 0;
  const allStones: string[] = [];

  for (const slot of loadout) {
    if (slot.artifactId) {
      const artifact = getArtifact(slot.artifactId);
      if (artifact) totalSlots += artifact.slots;
    }
    for (const stoneId of slot.stones) {
      if (stoneId) allStones.push(stoneId);
    }
  }

  if (totalSlots < 3 || allStones.length === 0) return null;

  const isEarnings = (id: string) => EARNINGS_STONE_PREFIXES.some(p => id.startsWith(p));
  const isDelivery = (id: string) => DELIVERY_STONE_PREFIXES.some(p => id.startsWith(p));
  if (allStones.every(isEarnings)) return 'earnings';
  if (allStones.every(isDelivery)) return 'elr';
  return null;
}
