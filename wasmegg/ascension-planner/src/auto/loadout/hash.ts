import { STONE_FAMILIES, STONE_TIERS, type AutoLoadoutInputs } from './types';

/**
 * Stable string for comparing loadout inputs: what a ChainedAscension was simulated with vs. what
 * it would be simulated with now. Earnings stones are left out — C1 re-sockets them from the pool.
 */
export function hashLoadoutInputs(inputs: AutoLoadoutInputs | null | undefined): string {
  if (!inputs) return '';
  const earnings = inputs.earnings.map(slot => slot.artifactId ?? '').join(',');
  const delivery =
    inputs.delivery.mode === 'fixed'
      ? `fixed:${inputs.delivery.artifactIds.map(id => id ?? '').join(',')}`
      : `auto:${inputs.delivery.candidates.map(c => c.artifactId).join(',')}`;
  const stones = STONE_FAMILIES.map(f => STONE_TIERS.map(t => inputs.stones[f][t]).join('.')).join('/');
  return `${earnings}|${delivery}|${stones}`;
}

export function loadoutInputsEqual(a: AutoLoadoutInputs | null | undefined, b: AutoLoadoutInputs | null | undefined) {
  return hashLoadoutInputs(a) === hashLoadoutInputs(b);
}

export function cloneLoadoutInputs(inputs: AutoLoadoutInputs): AutoLoadoutInputs {
  return JSON.parse(JSON.stringify(inputs));
}
