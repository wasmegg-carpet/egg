import type { ei } from 'lib/proto';
import { cteFromArtifacts } from 'lib/virtue';
import { equippedArtifactsToLibArtifacts } from '@/lib/artifacts/utils';
import type { EquippedArtifact } from '@/lib/artifacts/types';
import type { DeliveryPool, DeliveryPoolStone, DeliverySource } from '@/lib/artifacts/virtue';
import { withEmptyStones } from './fromBackup';
import { STONE_TIERS, stoneId, type AutoLoadoutInputs, type StoneFamily, type StonePool } from './types';

function poolStones(stones: StonePool, family: StoneFamily): DeliveryPoolStone[] {
  return [...STONE_TIERS]
    .reverse()
    .filter(tier => stones[family][tier] > 0)
    .map(tier => ({ id: stoneId(family, tier), tier, count: stones[family][tier] }));
}

/**
 * What the delivery (ELR) search runs over for these inputs: `auto` searches the candidates for the
 * best structure; `fixed` forces the user's structure. Either way stones come from the pool.
 */
export function deliverySearchFromInputs(inputs: AutoLoadoutInputs): {
  pool: DeliveryPool;
  forcedArtifacts?: (string | null)[];
} {
  const tachyon = poolStones(inputs.stones, 'tachyon');
  const quantum = poolStones(inputs.stones, 'quantum');
  if (inputs.delivery.mode === 'fixed') {
    const forced = inputs.delivery.artifactIds;
    return {
      pool: { candidates: forced.filter((id): id is string => !!id), tachyon, quantum },
      forcedArtifacts: forced,
    };
  }
  return { pool: { candidates: inputs.delivery.candidates.map(c => c.artifactId), tachyon, quantum } };
}

/** Where C3/H1's delivery search gets its inventory: the loadout inputs if set, else the backup. */
export function contextDeliverySource(context: {
  loadoutInputs?: AutoLoadoutInputs;
  rawBackup?: ei.IBackup;
}): DeliverySource | null {
  if (context.loadoutInputs) return deliverySearchFromInputs(context.loadoutInputs);
  return context.rawBackup ?? null;
}

/**
 * Socket the earnings set's stone slots from the pool's lunar and shell stones, in slot order.
 * Each socket takes the highest-tier lunar or the highest-tier shell stone still available,
 * whichever raises Clothed TE more (lunar on a tie). The artifacts themselves are kept as given;
 * sockets left over once both families run out stay empty.
 */
export function socketEarningsStones(earnings: EquippedArtifact[], stones: StonePool): EquippedArtifact[] {
  const set = withEmptyStones(earnings);
  const remaining = { lunar: poolStones(stones, 'lunar'), shell: poolStones(stones, 'shell') };
  const cte = () => cteFromArtifacts(equippedArtifactsToLibArtifacts(set));

  for (const slot of set) {
    for (let i = 0; i < slot.stones.length; i++) {
      let best: { stone: DeliveryPoolStone; value: number } | null = null;
      for (const family of ['lunar', 'shell'] as const) {
        const stone = remaining[family].find(s => s.count > 0);
        if (!stone) continue;
        slot.stones[i] = stone.id;
        const value = cte();
        if (!best || value > best.value) best = { stone, value };
      }
      slot.stones[i] = best ? best.stone.id : null;
      if (best) best.stone.count--;
    }
  }
  return set;
}
