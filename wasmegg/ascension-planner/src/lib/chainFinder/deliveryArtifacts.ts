/**
 * Delivery artifacts the Table Builder lets the player choose. Only the three delivery families
 * that vary between players are offered: every tier-4 rarity, plus a few lower-tier ones.
 */
import { getArtifactsByFamily, type ArtifactOption } from '@/lib/artifacts';

export const CHAIN_FINDER_DELIVERY_FAMILIES = ['quantum-metronome', 'interstellar-compass', 'gusset'] as const;
export type ChainFinderDeliveryFamily = (typeof CHAIN_FINDER_DELIVERY_FAMILIES)[number];

/** One chosen artifact id per family. */
export type ChainFinderDeliverySelection = Record<ChainFinderDeliveryFamily, string>;

/** Lower-tier artifacts offered besides every tier-4 rarity. */
const EXTRA_DELIVERY_OPTIONS = new Set(['quantum-metronome-3-2', 'gusset-2-2']);

/** A family's options: every tier-4 rarity plus its extras, best first (tier, then rarity). */
export function deliveryOptions(family: ChainFinderDeliveryFamily): ArtifactOption[] {
  return getArtifactsByFamily(family)
    .filter(a => a.tier === 4 || EXTRA_DELIVERY_OPTIONS.has(a.id))
    .sort((a, b) => b.tier - a.tier || b.rarity - a.rarity);
}

/** The delivery set's fourth artifact, fixed: the lunar totem, as in the maxed table's set. */
export const CHAIN_FINDER_FIXED_DELIVERY_ARTIFACT = 'lunar-totem-4-3';

/** The fixed delivery structure a table is simulated with: the three picks plus the lunar totem. */
export function chainFinderDeliveryIds(selection: ChainFinderDeliverySelection): string[] {
  return [...CHAIN_FINDER_DELIVERY_FAMILIES.map(f => selection[f]), CHAIN_FINDER_FIXED_DELIVERY_ARTIFACT];
}

/** Short tag for file names, e.g. `metronome-T4L_compass-T4E_gusset-T4L`. */
export function deliverySelectionTag(selection: ChainFinderDeliverySelection): string {
  return CHAIN_FINDER_DELIVERY_FAMILIES.map(f => {
    const option = deliveryOptions(f).find(o => o.id === selection[f]);
    const short = f === 'quantum-metronome' ? 'metronome' : f === 'interstellar-compass' ? 'compass' : f;
    return `${short}-${option ? `T${option.tier}${option.rarityCode}` : '?'}`;
  }).join('_');
}

/** Every family at its best option (T4L). */
export function defaultDeliverySelection(): ChainFinderDeliverySelection {
  const selection = {} as ChainFinderDeliverySelection;
  for (const family of CHAIN_FINDER_DELIVERY_FAMILIES) {
    const best = deliveryOptions(family)[0];
    if (!best) throw new Error(`no delivery options for ${family}`);
    selection[family] = best.id;
  }
  return selection;
}
