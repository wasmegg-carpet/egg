import { ei } from '../proto';

import Name = ei.ArtifactSpec.Name;

/**
 * Artifact-set recommendation strategies.
 *
 * Members are append-only: code compares strategies by identity, so reordering
 * existing members would silently change what existing numeric values mean.
 */
export enum Strategy {
  // Prestige strategies
  STANDARD_PERMIT_SINGLE_PRELOAD,
  PRO_PERMIT_SINGLE_PRELOAD,
  PRO_PERMIT_MULTI,
  PRO_PERMIT_LUNAR_PRELOAD_AIO,

  // Virtue strategies
  STANDARD_PERMIT_VIRTUE_CTE,
  PRO_PERMIT_VIRTUE_CTE,

  // Virtue delivery-rate (effective lay rate) strategies. The search behind
  // both is identical — they exist only so call sites can pick by permit the
  // same way they do for the CTE strategies.
  STANDARD_PERMIT_VIRTUE_ELR,
  PRO_PERMIT_VIRTUE_ELR,
}

export function isVirtueStrategy(strategy: Strategy): boolean {
  return (
    strategy === Strategy.STANDARD_PERMIT_VIRTUE_CTE ||
    strategy === Strategy.PRO_PERMIT_VIRTUE_CTE ||
    strategy === Strategy.STANDARD_PERMIT_VIRTUE_ELR ||
    strategy === Strategy.PRO_PERMIT_VIRTUE_ELR
  );
}

export function isElrStrategy(strategy: Strategy): boolean {
  return strategy === Strategy.STANDARD_PERMIT_VIRTUE_ELR || strategy === Strategy.PRO_PERMIT_VIRTUE_ELR;
}

/**
 * Artifact families the delivery-rate search optimizes around; every other
 * owned artifact is only a candidate for the stone slots it carries.
 */
export const ELR_TARGET_AFX_IDS: Name[] = [Name.QUANTUM_METRONOME, Name.INTERSTELLAR_COMPASS, Name.ORNATE_GUSSET];

/** Stone families the delivery-rate search balances into artifact slots. */
export const ELR_STONE_FAMILY_IDS = {
  tachyon: 'tachyon-stone',
  quantum: 'quantum-stone',
} as const;
