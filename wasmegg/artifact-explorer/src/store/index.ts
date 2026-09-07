import { computed, ref, shallowRef } from 'vue';

import {
  ei,
  fixOldShipsConfig,
  fuelTankSizes,
  getArtifactTierPropsFromId,
  getCraftingLevelFromXp,
  getLocalStorage,
  Inventory,
  isOldShipsConfig,
  isShipsConfig,
  newShipsConfig,
  perfectShipsConfig,
  setLocalStorage,
  shipLevelLaunchPointThresholds,
  ShipsConfig,
  spaceshipList,
} from 'lib';

import Spaceship = ei.MissionInfo.Spaceship;
import DurationType = ei.MissionInfo.DurationType;

import {
  DEFAULT_MAX_GOLDEN_EGG_COST,
  DEFAULT_WAIT_TIME_DAYS,
  EffortLevel,
  ExtrasConfig,
  isEffortLevel,
  isExtrasConfig,
  isMissionFilters,
  isOverrideFlags,
  MissionFilters,
  newExtras,
  newMissionFilters,
  newOverrides,
  OverrideFlags,
} from './schema';
export type { ExtrasConfig, MissionFilters, OverrideFlags, EffortLevel } from './schema';
export { EFFORT_LEVELS, EFFORT_LAUNCH_PERIOD_SECONDS } from './schema';

export const CONFIG_LOCALSTORAGE_KEY = 'config';
export const OVERRIDES_LOCALSTORAGE_KEY = 'overrides';
export const EXTRAS_LOCALSTORAGE_KEY = 'extras';
export const MISSION_FILTERS_LOCALSTORAGE_KEY = 'mission_filters';
// EID whose save the manual (override) values were last seeded from.
export const SEEDED_EID_LOCALSTORAGE_KEY = 'seeded_eid';

// config is persisted through a watch in App.vue.
export const config = ref(loadConfig());
export const configModalOpen = ref(false);

export function setEpicResearchFTLLevel(level: number): void {
  config.value.epicResearchFTLLevel = level;
}

export function setEpicResearchZerogLevel(level: number): void {
  config.value.epicResearchZerogLevel = level;
}

export function setShipLevel(ship: ei.MissionInfo.Spaceship, level: number): void {
  config.value.shipLevels[ship] = level;
}

export function setShipVisibility(ship: ei.MissionInfo.Spaceship, visible: boolean): void {
  config.value.shipVisibility[ship] = visible;
}

export const overrides = ref<OverrideFlags>(loadOverrides());
export const playerOverridesModalOpen = ref(false);

export function setOverrideCraftingLevel(b: boolean): void {
  overrides.value.craftingLevel = b;
}

export function setOverridePreviousCrafts(b: boolean): void {
  overrides.value.previousCrafts = b;
}

export function setOverrideFTL(b: boolean): void {
  overrides.value.epicResearchFTLLevel = b;
}

export function setOverrideZerog(b: boolean): void {
  overrides.value.epicResearchZerogLevel = b;
}

export function setOverrideShipLevel(ship: Spaceship, b: boolean): void {
  overrides.value.shipLevels[ship] = b;
}

export function setOverrideShipVisibility(ship: Spaceship, b: boolean): void {
  overrides.value.shipVisibility[ship] = b;
}

export function takeControlOfAllShips(): void {
  for (const s of spaceshipList) {
    overrides.value.shipLevels[s] = true;
    overrides.value.shipVisibility[s] = true;
  }
}

export function releaseControlOfAllShips(): void {
  for (const s of spaceshipList) {
    overrides.value.shipLevels[s] = false;
    overrides.value.shipVisibility[s] = false;
  }
}

export function setOverrideTankLevel(b: boolean): void {
  overrides.value.tankLevel = b;
}

export const extras = ref<ExtrasConfig>(loadExtras());

export function setCraftingLevel(level: number): void {
  extras.value.craftingLevel = level;
}

export function setPreviousCraftCount(count: number): void {
  extras.value.previousCrafts = count;
}

export function setTankLevel(level: number): void {
  extras.value.tankLevel = level;
}

// Player data loaded from a save. Never persisted.
export const playerShipsConfig = ref<ShipsConfig | null>(null);
export const playerInventory = shallowRef<Inventory | null>(null);
export const playerTotalCraftingXp = ref<number | null>(null);
export const playerTankLevel = ref<number | null>(null);
// Golden eggs the player can actually spend: lifetime earned less lifetime spent.
export const playerGoldenEggs = ref<number | null>(null);

// Set by ArtifactMissionOptimizer; read by the settings UI.
export const currentOptimizerArtifactIds = ref<string[]>([]);

export const playerCraftingLevel = computed<number | null>(() => {
  const xp = playerTotalCraftingXp.value;
  if (xp == null) return null;
  return getCraftingLevelFromXp(xp).level;
});

export const playerPreviousCraftsByArtifact = computed<Map<string, number>>(() => {
  const counts = new Map<string, number>();
  const inv = playerInventory.value;
  if (!inv) return counts;
  for (const id of currentOptimizerArtifactIds.value) {
    const props = getArtifactTierPropsFromId(id);
    counts.set(id, inv.getItem({ name: props.afx_id, level: props.afx_level }).crafted);
  }
  return counts;
});

// The first target's count, used to seed the manual value.
export const playerPreviousCrafts = computed<number | null>(() => {
  const id = currentOptimizerArtifactIds.value[0];
  if (id === undefined) return null;
  return playerPreviousCraftsByArtifact.value.get(id) ?? null;
});

export const effectiveCraftingLevel = computed<number>(() => {
  const player = playerCraftingLevel.value;
  if (player == null) return extras.value.craftingLevel;
  return overrides.value.craftingLevel ? extras.value.craftingLevel : player;
});

// undefined means every target uses its own crafted count from the save.
export const effectivePreviousCraftsOverride = computed<number | undefined>(() => {
  if (!playerInventory.value) return extras.value.previousCrafts;
  return overrides.value.previousCrafts ? extras.value.previousCrafts : undefined;
});

export const effectiveTankLevel = computed<number>(() => {
  const player = playerTankLevel.value;
  if (player == null) return fuelTankSizes.length - 1; // largest
  return overrides.value.tankLevel ? extras.value.tankLevel : player;
});

export const effectiveFuelTankCapacity = computed<number>(() => fuelTankSizes[effectiveTankLevel.value]);

export const effectiveConfig = computed<ShipsConfig>(() => {
  const player = playerShipsConfig.value;
  if (!player) return config.value;
  const o = overrides.value;
  const shipLevels = { ...player.shipLevels };
  const shipVisibility = { ...player.shipVisibility };
  for (const s of spaceshipList) {
    if (o.shipLevels[s]) shipLevels[s] = config.value.shipLevels[s];
    if (o.shipVisibility[s]) shipVisibility[s] = config.value.shipVisibility[s];
  }
  return {
    ...player,
    epicResearchFTLLevel: o.epicResearchFTLLevel ? config.value.epicResearchFTLLevel : player.epicResearchFTLLevel,
    epicResearchZerogLevel: o.epicResearchZerogLevel
      ? config.value.epicResearchZerogLevel
      : player.epicResearchZerogLevel,
    shipLevels,
    shipVisibility,
    showNodata: config.value.showNodata,
    targets: config.value.targets,
  };
});

function seedOverrideValuesFromPlayerData(): void {
  const player = playerShipsConfig.value;
  if (player) {
    config.value.epicResearchFTLLevel = player.epicResearchFTLLevel;
    config.value.epicResearchZerogLevel = player.epicResearchZerogLevel;
    config.value.shipLevels = { ...player.shipLevels };
    config.value.shipVisibility = { ...player.shipVisibility };
  }
  if (playerCraftingLevel.value !== null) {
    extras.value.craftingLevel = playerCraftingLevel.value;
  }
  // Per-artifact, so only available while the optimizer is open.
  if (playerPreviousCrafts.value !== null) {
    extras.value.previousCrafts = playerPreviousCrafts.value;
  }
  if (playerTankLevel.value !== null) {
    extras.value.tankLevel = playerTankLevel.value;
  }
}

function computeShipLevelFromPoints(shipType: Spaceship, points: number): number {
  const thresholds = shipLevelLaunchPointThresholds(shipType);
  let level = 0;
  for (; level < thresholds.length; level++) {
    if (points < thresholds[level]) return Math.max(0, level - 1);
  }
  return thresholds.length - 1;
}

export function setPlayerData(backup: ei.IBackup): void {
  if (!backup.game || !backup.artifactsDb) return;

  const base = newShipsConfig(backup.game);

  const launchPoints: Partial<Record<Spaceship, number>> = {};
  const hasLaunched: Partial<Record<Spaceship, boolean>> = {};

  const missions = (backup.artifactsDb.missionArchive ?? [])
    .concat(backup.artifactsDb.missionInfos ?? [])
    .filter(m => (m.status ?? 0) >= ei.MissionInfo.Status.EXPLORING);

  for (const mission of missions) {
    const ship = mission.ship!;
    let pts = 1.0;
    if (mission.durationType === DurationType.LONG) pts = 1.4;
    else if (mission.durationType === DurationType.EPIC) pts = 1.8;
    launchPoints[ship] = (launchPoints[ship] ?? 0) + pts;
    hasLaunched[ship] = true;
  }

  for (const shipType of spaceshipList) {
    base.shipLevels[shipType] = computeShipLevelFromPoints(shipType, launchPoints[shipType] ?? 0);
    base.shipVisibility[shipType] = shipType === Spaceship.CHICKEN_ONE ? true : (hasLaunched[shipType] ?? false);
  }

  // targets and showNodata aren't in the backup; keep the user's settings
  base.targets = config.value.targets;
  base.showNodata = config.value.showNodata;

  playerShipsConfig.value = base;

  const inv = new Inventory(backup.artifactsDb, { virtue: true });
  for (const item of backup.artifactsDb.virtueAfxDb?.artifactStatus || []) {
    inv.getItem(item.spec!).crafted += item.count!;
  }
  playerInventory.value = inv;
  playerTotalCraftingXp.value = Math.floor(backup.artifacts?.craftingXp ?? 0);
  playerTankLevel.value = backup.artifacts?.tankLevel ?? null;
  playerGoldenEggs.value = Math.max(0, (backup.game.goldenEggsEarned ?? 0) - (backup.game.goldenEggsSpent ?? 0));

  // The cap tracks the save's balance for as long as it is off, so ticking it on means "what I can
  // afford right now". Once on the value is the user's, and reloading a save leaves it be.
  if (!missionFilters.value.maxGoldenEggCostEnabled) {
    missionFilters.value.maxGoldenEggCost = playerGoldenEggs.value;
  }

  const eid = backup.eiUserId;
  if (eid && getLocalStorage(SEEDED_EID_LOCALSTORAGE_KEY) !== eid) {
    seedOverrideValuesFromPlayerData();
    setLocalStorage(SEEDED_EID_LOCALSTORAGE_KEY, eid);
  }
}

export function clearPlayerData(): void {
  playerShipsConfig.value = null;
  playerInventory.value = null;
  playerTotalCraftingXp.value = null;
  playerTankLevel.value = null;
  playerGoldenEggs.value = null;
}

export function loadConfig(): ShipsConfig {
  const str = getLocalStorage(CONFIG_LOCALSTORAGE_KEY);
  if (!str) {
    return perfectShipsConfig;
  }
  let storedConfig: unknown;
  try {
    storedConfig = JSON.parse(str);
  } catch (err) {
    console.warn(`error parsing config: ${err}`);
    return perfectShipsConfig;
  }
  if (isShipsConfig(storedConfig)) {
    return storedConfig;
  } else if (isOldShipsConfig(storedConfig)) {
    return fixOldShipsConfig(storedConfig);
  } else {
    return perfectShipsConfig;
  }
}

export function persistConfig() {
  setLocalStorage(CONFIG_LOCALSTORAGE_KEY, JSON.stringify(config.value));
}

export function configWithCustomShipLevel(ship: ei.MissionInfo.Spaceship, level: number): ShipsConfig {
  const shipLevels = { ...config.value.shipLevels };
  shipLevels[ship] = level;
  return {
    ...config.value,
    shipLevels,
  };
}

export function openConfigModal(): void {
  configModalOpen.value = true;
}

export function closeConfigModal(): void {
  configModalOpen.value = false;
}

export function openPlayerOverridesModal(): void {
  playerOverridesModalOpen.value = true;
}

export function closePlayerOverridesModal(): void {
  playerOverridesModalOpen.value = false;
}

export function loadOverrides(): OverrideFlags {
  const str = getLocalStorage(OVERRIDES_LOCALSTORAGE_KEY);
  if (!str) return newOverrides();
  try {
    const parsed: unknown = JSON.parse(str);
    if (isOverrideFlags(parsed)) {
      return {
        ...parsed,
        tankLevel: parsed.tankLevel ?? false,
      };
    }
  } catch (err) {
    console.warn(`error parsing overrides: ${err}`);
  }
  return newOverrides();
}

export function persistOverrides(): void {
  setLocalStorage(OVERRIDES_LOCALSTORAGE_KEY, JSON.stringify(overrides.value));
}

export function loadExtras(): ExtrasConfig {
  const str = getLocalStorage(EXTRAS_LOCALSTORAGE_KEY);
  if (!str) return newExtras(fuelTankSizes.length - 1);
  try {
    const parsed: unknown = JSON.parse(str);
    if (isExtrasConfig(parsed)) {
      return {
        ...parsed,
        tankLevel: parsed.tankLevel ?? fuelTankSizes.length - 1,
      };
    }
  } catch (err) {
    console.warn(`error parsing extras: ${err}`);
  }
  return newExtras(fuelTankSizes.length - 1);
}

export function persistExtras(): void {
  setLocalStorage(EXTRAS_LOCALSTORAGE_KEY, JSON.stringify(extras.value));
}

export const missionFilters = ref<MissionFilters>(loadMissionFilters());

export function setEffort(level: EffortLevel): void {
  missionFilters.value.effort = level;
}

export function setMaxGemCostEnabled(enabled: boolean): void {
  missionFilters.value.maxGemCostEnabled = enabled;
}

export function setMaxGemCost(cost: number): void {
  missionFilters.value.maxGemCost = Math.max(0, cost);
}

export function setMaxGoldenEggCostEnabled(enabled: boolean): void {
  missionFilters.value.maxGoldenEggCostEnabled = enabled;
}

// Non-finite is dropped rather than clamped: `Math.max(0, NaN)` is NaN, and a NaN or Infinity capacity
// reads downstream as "no cap" — the checkbox would stay on with nothing enforcing it.
export function setMaxGoldenEggCost(cost: number): void {
  if (!Number.isFinite(cost)) return;
  missionFilters.value.maxGoldenEggCost = Math.max(0, cost);
}

export function setWaitTimeDays(v: string): void {
  missionFilters.value.waitTimeDays = v;
}

export function loadMissionFilters(): MissionFilters {
  const str = getLocalStorage(MISSION_FILTERS_LOCALSTORAGE_KEY);
  if (!str) return newMissionFilters();
  try {
    const parsed: unknown = JSON.parse(str);
    if (isMissionFilters(parsed)) {
      return {
        ...parsed,
        effort: isEffortLevel(parsed.effort) ? parsed.effort : 'medium',
        maxGemCostEnabled: parsed.maxGemCostEnabled ?? false,
        maxGemCost: parsed.maxGemCost ?? 0,
        maxGoldenEggCostEnabled: parsed.maxGoldenEggCostEnabled ?? false,
        maxGoldenEggCost: parsed.maxGoldenEggCost ?? DEFAULT_MAX_GOLDEN_EGG_COST,
        waitTimeDays: parsed.waitTimeDays ?? DEFAULT_WAIT_TIME_DAYS,
      };
    }
  } catch (err) {
    console.warn(`error parsing mission filters: ${err}`);
  }
  return newMissionFilters();
}

export function persistMissionFilters(): void {
  setLocalStorage(MISSION_FILTERS_LOCALSTORAGE_KEY, JSON.stringify(missionFilters.value));
}

export const AUTO_COMPUTE_LOCALSTORAGE_KEY = 'auto_compute';

export const autoCompute = ref<boolean>(loadAutoCompute());

export function setAutoCompute(b: boolean): void {
  autoCompute.value = b;
}

function loadAutoCompute(): boolean {
  const str = getLocalStorage(AUTO_COMPUTE_LOCALSTORAGE_KEY);
  if (str === 'false') return false;
  return true;
}

export function persistAutoCompute(): void {
  setLocalStorage(AUTO_COMPUTE_LOCALSTORAGE_KEY, String(autoCompute.value));
}
