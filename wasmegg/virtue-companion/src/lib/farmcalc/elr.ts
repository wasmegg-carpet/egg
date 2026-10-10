import {
  ei,
  Artifact,
  ArtifactSet,
  Contender,
  Inventory,
  Modifiers,
  Strategy,
  ArtifactAssemblyStatusNonMissing,
  allModifiersFromColleggtibles,
  contenderToArtifactSet,
  equippedArtifactsToLibArtifacts,
  libArtifactToEquippedArtifact,
  recommendElrSet,
  EquippedArtifact,
} from 'lib';
import { farmHabs, farmHabSpaceResearches, farmHabSpaces } from './hab_space';
import { farmEggLayingRateResearches, farmEggLayingRatePerChicken } from './laying_rate';
import { farmVehicles, farmShippingCapacityResearches, farmVehicleShippingCapacities } from './shipping_capacity';

/**
 * Options for {@link getOptimalELRSet}.
 */
export interface GetOptimalELRSetOptions {
  /** Colleggtible modifiers; defaults to the backup's own. */
  modifiers?: Modifiers;
  /** Skip Ornate Gussets when searching for candidate artifact structures. */
  excludeGusset?: boolean;
  /** If the winning set is functionally identical to this one, return it unchanged. */
  currentSet?: (EquippedArtifact | null)[] | null;
  /**
   * Defaults to true. When true, population is taken to be the artifact-adjusted hab capacity
   * (i.e. assume the player will fill their habitats, so Gussets can raise the population); when
   * false, the farm's current population is used instead (so Gussets don't affect lay rate).
   */
  assumeMaxPopulation?: boolean;
  /** Current population to use when `assumeMaxPopulation` is false. Defaults to the backup's. */
  currentPopulation?: number;
  /**
   * Currently equipped set. Besides marking which artifacts are equipped / assembled, it acts as
   * the functional-identity baseline: when the winning structure is only functionally identical
   * to it (e.g. a same-slot holder swap that doesn't affect delivery rate), the equipped set is
   * kept so the gallery shows the set as already optimal.
   */
  equipped?: ArtifactSet;
}

/**
 * The recommended delivery-rate set together with a per-artifact assembly status,
 * matching the shape returned for the Clothed TE recommendation.
 */
export interface OptimalELRSetResult {
  artifactSet: ArtifactSet;
  assemblyStatuses: ArtifactAssemblyStatusNonMissing[];
}

/**
 * Get the optimal artifact set for Effective Lay Rate (delivery rate) from the
 * player's virtue inventory: the Metronome / Compass / Gusset structure plus
 * Tachyon/Quantum stone placement that maximizes min(lay rate, shipping capacity).
 *
 * Uses the shared search in `lib/artifacts` (the same implementation the
 * ascension planner uses), supplying this app's own farmcalculations as the
 * evaluator. The winning loadout is then passed through `contenderToArtifactSet`
 * so each artifact gets an assembly status (equipped / assembled / awaiting
 * assembly), exactly as the Clothed TE recommendation does.
 */
export function getOptimalELRSet(backup: ei.IBackup, options: GetOptimalELRSetOptions = {}): OptimalELRSetResult {
  const farm = backup.farms?.[0];
  const progress = backup.game;
  const equipped = options.equipped ?? new ArtifactSet([], false);
  if (!backup.artifactsDb || !farm || !progress) {
    return { artifactSet: new ArtifactSet([], false), assemblyStatuses: [] };
  }

  const assumeMaxPopulation = options.assumeMaxPopulation ?? true;
  const inventory = new Inventory(backup.artifactsDb, { virtue: true });
  const modifiers = options.modifiers ?? allModifiersFromColleggtibles(backup);

  // Precompute everything that doesn't depend on the candidate loadout.
  const habs = farmHabs(farm);
  const habResearches = farmHabSpaceResearches(farm);
  const eggLayingResearches = farmEggLayingRateResearches(farm, progress);
  const vehicles = farmVehicles(farm);
  const shippingResearches = farmShippingCapacityResearches(farm, progress);
  const currentPopulation = options.currentPopulation ?? farm.numChickens ?? 0;

  const evaluate = (loadout: EquippedArtifact[]) => {
    const artifacts: Artifact[] = equippedArtifactsToLibArtifacts(loadout);
    const maxPopulation = farmHabSpaces(habs, habResearches, artifacts, modifiers.habCap).reduce((a, b) => a + b, 0);
    const population = assumeMaxPopulation ? maxPopulation : currentPopulation;
    const layRate = population * farmEggLayingRatePerChicken(eggLayingResearches, artifacts) * modifiers.elr;
    const shipRate = farmVehicleShippingCapacities(
      vehicles,
      shippingResearches,
      artifacts,
      modifiers.shippingCap
    ).reduce((a, b) => a + b, 0);
    return { layRate, shipRate, elr: Math.min(layRate, shipRate) };
  };

  // Treat the currently equipped set as the functional-identity baseline: the search's
  // tie-breaking can otherwise return a structure that plays identically (e.g. a 3-slot
  // Chalice instead of the equipped 3-slot Lunar Totem — neither affects delivery rate),
  // which would show up as a pointless "swap" recommendation.
  const currentSet =
    options.currentSet ??
    (equipped.artifacts.length > 0 ? equipped.artifacts.map(afx => libArtifactToEquippedArtifact(afx)) : undefined);

  // Same permit-based strategy choice as the CTE recommendation.
  const strategy = progress.permitLevel === 1 ? Strategy.PRO_PERMIT_VIRTUE_ELR : Strategy.STANDARD_PERMIT_VIRTUE_ELR;
  const loadout = recommendElrSet(backup, strategy, {
    inventory,
    excludeGusset: options.excludeGusset,
    currentSet,
    evaluate,
  });

  // Resolve the winning loadout against the equipped set / inventory so each
  // artifact carries the same assembly status the CTE recommendation shows.
  const contender = Contender.fromArtifactSet(new ArtifactSet(equippedArtifactsToLibArtifacts(loadout), false));
  return contenderToArtifactSet(contender, equipped, inventory);
}
