import { defineStore } from 'pinia';
import type {
  InitialState,
  ResearchLevels,
  FuelEgg,
  CurrentFarmState,
  ActiveMissionInfo,
} from '@/types';
import { ei, Mission, getNumProphecyEggs, getNumSoulEggs, getNumTruthEggs } from 'lib';
import { epicResearchDefs } from 'lib/planners/epicResearch';
import {
  type ColleggtibleTiers,
  type Modifiers as ColleggtibleModifiers,
  getDefaultColleggtibleTiers,
  getColleggtibleTiers,
  modifiersFromColleggtibleTiers as calculateColleggtibleModifiers,
} from 'lib/collegtibles';
import {
  type EquippedArtifact,
  type ArtifactModifiers,
  createEmptyLoadout,
  calculateArtifactModifiers,
  activeSlots,
  getArtifactLoadoutFromBackup,
} from '@/lib/artifacts';
import { parseEnlightenmentFarm } from '@/lib/backupFarm';
import { defaultResearchCube, type ResearchCubeSetting } from '@/lib/artifacts/researchCube';
import { createEmptyFuelAmounts, eiEggToFuelEgg } from '@/types';
import { useFuelTankStore } from './fuelTank';

export interface InitialStateStoreState {
  // Whether data has been loaded from a backup
  hasData: boolean;

  // Player info
  playerId: string;
  nickname: string;
  isUltra: boolean;
  lastBackupTime: number;

  // Epic research levels
  epicResearchLevels: ResearchLevels;

  // Colleggtible tiers (-1 = none, 0-3 = tier 1-4)
  colleggtibleTiers: ColleggtibleTiers;

  // Artifact loadout (4 slots)
  artifactLoadout: EquippedArtifact[];
  artifactSets: Record<import('@/types').ArtifactSetName, EquippedArtifact[] | null>;
  activeArtifactSet: import('@/types').ArtifactSetName | null;

  // Current farm state (only if the save has an enlightenment farm)
  currentFarmState: CurrentFarmState | null;

  // Earning bonus inputs from the backup. A plan can't change them: SE only come with a prestige,
  // and PE and TE don't come from this farm.
  soulEggs: number;
  prophecyEggs: number;
  truthEggs: number;

  // Assume double earnings (video doubler)
  assumeDoubleEarnings: boolean;

  // Research is priced as if this puzzle cube (with its clarity stones) is swapped in for each purchase
  researchCube: ResearchCubeSetting;

  // Pro permit (vs. Standard): Standard halves offline earnings, caps silos at 2 and active artifacts at 2
  proPermit: boolean;

  // Global progress metrics at start of ascension
  initialTankLevel: number;
  initialFuelAmounts: Record<FuelEgg, number>;

  // Whether this is a continuation of an existing farm
  isContinuing: boolean;

  // Active missions from backup
  activeMissions: ei.IMissionInfo[];

  // Original backup data for re-calculating optimal sets
  rawBackup: ei.IBackup | null;
}

/** Soul Eggs a plan assumes with no backup loaded. */
const DEFAULT_SOUL_EGGS = 1e21;

function initializeEpicResearchLevels(): ResearchLevels {
  const levels: ResearchLevels = {};
  for (const research of epicResearchDefs) {
    levels[research.id] = 0;
  }
  return levels;
}

export const useInitialStateStore = defineStore('initialState', {
  state: (): InitialStateStoreState => ({
    hasData: false,
    isContinuing: false,
    playerId: '',
    nickname: '',
    isUltra: false,
    lastBackupTime: 0,
    epicResearchLevels: initializeEpicResearchLevels(),
    colleggtibleTiers: getDefaultColleggtibleTiers(),
    artifactLoadout: createEmptyLoadout(),
    artifactSets: {
      earnings: null,
      elr: null,
    },
    activeArtifactSet: null,
    currentFarmState: null,
    soulEggs: DEFAULT_SOUL_EGGS,
    prophecyEggs: 0,
    truthEggs: 0,
    assumeDoubleEarnings: true,
    researchCube: defaultResearchCube(),
    proPermit: true,
    initialTankLevel: 0,
    initialFuelAmounts: createEmptyFuelAmounts(),
    activeMissions: [],
    rawBackup: null,
  }),

  getters: {
    /**
     * Get the initial state as a typed object
     */
    initialState(): InitialState {
      return {
        playerId: this.playerId,
        nickname: this.nickname,
        lastBackupTime: this.lastBackupTime,
      };
    },

    /**
     * Get calculated colleggtible modifiers from tiers
     */
    colleggtibleModifiers(): ColleggtibleModifiers {
      return calculateColleggtibleModifiers(this.colleggtibleTiers);
    },

    /**
     * Get calculated artifact modifiers from loadout
     */
    artifactModifiers(): ArtifactModifiers {
      return calculateArtifactModifiers(activeSlots(this.artifactLoadout, this.proPermit));
    },

    /**
     * Get active non-virtue missions from backup
     */
    regularMissions(): ActiveMissionInfo[] {
      return this.activeMissions
        .map(m => new Mission(m))
        .filter(m => m.type !== ei.MissionInfo.MissionType.VIRTUE)
        .map(m => ({
          ship: m.shipType,
          duration: m.durationType,
          shipName: m.shipName,
          durationTypeName: m.durationTypeName,
          shipIconPath: m.shipIconPath,
          sensorTarget: m.sensorTarget,
          returnTimestamp: m.returnTimestamp,
          statusIsFueling: m.statusIsFueling,
          statusName: m.statusName,
          capacity: m.capacity,
          durationSeconds: m.durationSeconds,
          fuels: m.fuels.map(f => ({
            egg: f.egg,
            amount: f.amount,
            eggIconPath: f.eggIconPath,
          })),
        }));
    },
  },

  actions: {
    /**
     * Load initial state from player backup data.
     * Returns the initial shift count for the virtue store.
     */
    loadFromBackup(
      playerId: string,
      backup: ei.IBackup,
      mode: 'scratch' | 'plan_next' | 'continue' | 'reconcile' | 'default' = 'default'
    ): {
      isUltra: boolean;
      tankLevel: number;
      fuelAmounts: Record<FuelEgg, number>;
    } {
      this.hasData = true;
      this.isContinuing = mode === 'continue';
      this.rawBackup = backup;
      this.playerId = playerId;
      this.nickname = backup.userName || playerId;
      this.isUltra =
        backup.subInfo?.subscriptionLevel != null && backup.subInfo.status === ei.UserSubscriptionInfo.Status.ACTIVE;
      this.lastBackupTime = backup.settings?.lastBackupTime || backup.approxTime || 0;
      this.soulEggs = getNumSoulEggs(backup);
      this.prophecyEggs = backup.game?.eggsOfProphecy ?? getNumProphecyEggs(backup);
      this.truthEggs = getNumTruthEggs(backup);
      // Reconciling keeps the loaded plan's own permit: a plan runs on the permit it was built with.
      if (mode !== 'reconcile') this.proPermit = backup.game?.permitLevel === 1;

      const artifactsDB = backup.artifactsDb || {};
      this.activeMissions = [
        ...(artifactsDB.missionInfos || []),
        ...(artifactsDB.fuelingMission ? [artifactsDB.fuelingMission] : []),
      ];

      // Load epic research levels
      this.epicResearchLevels = initializeEpicResearchLevels();
      if (backup.game?.epicResearch) {
        for (const research of backup.game.epicResearch) {
          if (research.id && research.level !== null && research.level !== undefined) {
            this.epicResearchLevels[research.id] = research.level;
          }
        }
      }

      // Load colleggtible tiers from contracts
      this.colleggtibleTiers = getColleggtibleTiers(backup);

      // Load artifact loadout from backup
      const backupLoadout = getArtifactLoadoutFromBackup(backup);
      this.artifactLoadout = backupLoadout;

      // A plan starts from what's equipped now. The second set starts empty for the player to fill.
      if (mode !== 'reconcile') {
        this.artifactSets.earnings = backupLoadout;
        this.artifactSets.elr = null;
        this.setActiveArtifactSet('earnings');
      }

      // Fuel tank: the regular tank, in ei.Egg order. It can also hold entries for virtue eggs (a
      // 25-long list), which this farm can neither use nor add to.
      const tankLevel = backup.artifacts?.tankLevel ?? 0;
      const fuelAmounts = createEmptyFuelAmounts();
      (backup.artifacts?.tankFuels ?? []).forEach((amount, index) => {
        const egg = eiEggToFuelEgg(ei.Egg.EDIBLE + index);
        if (egg) fuelAmounts[egg] = amount;
      });
      this.initialTankLevel = tankLevel;
      this.initialFuelAmounts = { ...fuelAmounts };

      // Load current farm state if the save has an enlightenment farm
      this.currentFarmState = parseEnlightenmentFarm(backup);

      return {
        isUltra: this.isUltra,
        tankLevel,
        fuelAmounts,
      };
    },

    /**
     * Set epic research level
     */
    setEpicResearchLevel(researchId: string, level: number) {
      const def = epicResearchDefs.find(r => r.id === researchId);
      if (def) {
        this.epicResearchLevels = {
          ...this.epicResearchLevels,
          [researchId]: Math.max(0, Math.min(level, def.maxLevel)),
        };
      }
    },

    /**
     * Set colleggtible tier
     */
    setColleggtibleTier(id: string, tierIndex: number) {
      if (id in this.colleggtibleTiers) {
        // Replace the entire object to guarantee Vue reactivity propagation.
        // In-place mutation (this.colleggtibleTiers[id] = x) can fail to trigger
        // re-renders in child components that receive the whole object as a prop,
        // because the object reference identity doesn't change.
        this.colleggtibleTiers = {
          ...this.colleggtibleTiers,
          [id]: Math.max(-1, Math.min(3, tierIndex)),
        };
      }
    },

    /**
     * Set artifact loadout
     */
    setArtifactLoadout(loadout: EquippedArtifact[]) {
      this.artifactLoadout = loadout;
    },

    /**
     * Set active artifact set and update current loadout
     */
    setActiveArtifactSet(setName: import('@/types').ArtifactSetName | null) {
      this.activeArtifactSet = setName;
      if (setName && this.artifactSets[setName]) {
        this.artifactLoadout = JSON.parse(JSON.stringify(this.artifactSets[setName]));
      } else if (setName) {
        // Set exists but is empty/null — clear to empty loadout
        this.artifactLoadout = createEmptyLoadout();
      }
    },

    /**
     * Update an artifact set's content
     */
    updateArtifactSet(setName: import('@/types').ArtifactSetName, loadout: EquippedArtifact[]) {
      this.artifactSets[setName] = JSON.parse(JSON.stringify(loadout));
      // If updating the active set, also update current loadout
      if (this.activeArtifactSet === setName) {
        this.artifactLoadout = JSON.parse(JSON.stringify(loadout));
      }
    },

    /**
     * Save current loadout to a set
     */
    saveCurrentToSet(setName: import('@/types').ArtifactSetName) {
      this.artifactSets[setName] = JSON.parse(JSON.stringify(this.artifactLoadout));
      this.activeArtifactSet = setName;
    },

    /**
     * Set soul eggs
     */
    setSoulEggs(count: number) {
      this.soulEggs = Math.max(0, count);
    },

    /**
     * Set eggs of prophecy
     */
    setProphecyEggs(count: number) {
      this.prophecyEggs = Math.max(0, Math.round(count));
    },

    /**
     * Set truth eggs
     */
    setTruthEggs(count: number) {
      this.truthEggs = Math.max(0, Math.round(count));
    },

    /**
     * Turn the research puzzle cube on or off, or change which cube and clarity stones it is
     */
    setResearchCube(setting: Partial<ResearchCubeSetting>) {
      this.researchCube = { ...this.researchCube, ...setting };
    },

    /**
     * Set assume double earnings
     */
    setAssumeDoubleEarnings(enabled: boolean) {
      this.assumeDoubleEarnings = enabled;
    },

    /**
     * Set Pro vs. Standard permit.
     */
    setProPermit(enabled: boolean) {
      this.proPermit = enabled;
    },

    /**
     * Hydrate store from exported data.
     */
    hydrate(data: Partial<InitialStateStoreState>) {
      this.hasData = true;
      this.isContinuing = data.isContinuing || false;
      this.playerId = data.playerId || '';
      this.nickname = data.nickname || 'Redacted';
      this.isUltra = data.isUltra || false;
      this.lastBackupTime = data.lastBackupTime || 0;
      this.soulEggs = data.soulEggs ?? DEFAULT_SOUL_EGGS;
      this.prophecyEggs = data.prophecyEggs ?? 0;
      this.truthEggs = data.truthEggs ?? 0;

      if (data.epicResearchLevels) {
        this.epicResearchLevels = { ...data.epicResearchLevels };
      }
      if (data.colleggtibleTiers) {
        // Merge onto current defaults rather than replacing outright, so
        // colleggtibles released after this plan was saved (and therefore
        // absent from the saved data) still get an entry instead of being
        // silently dropped and unsettable in the UI.
        this.colleggtibleTiers = {
          ...getDefaultColleggtibleTiers(),
          ...data.colleggtibleTiers,
        };
      }
      if (data.artifactLoadout) {
        this.artifactLoadout = [...data.artifactLoadout];
      }
      if (data.artifactSets) {
        this.artifactSets = { ...data.artifactSets };
      }
      if (data.activeArtifactSet !== undefined) {
        this.activeArtifactSet = data.activeArtifactSet;
      }
      // Fallback: if activeArtifactSet is still null but the loadout has artifacts,
      // stick to default rather than guessing.
      if (this.activeArtifactSet === null && this.artifactLoadout.some(s => s.artifactId)) {
        this.activeArtifactSet = 'earnings';
      }
      this.researchCube = data.researchCube ? { ...data.researchCube } : defaultResearchCube();
      if (data.assumeDoubleEarnings !== undefined) {
        this.assumeDoubleEarnings = data.assumeDoubleEarnings;
      } else {
        this.assumeDoubleEarnings = true;
      }
      // Plans saved before Standard permit was supported were all built as Pro.
      this.proPermit = data.proPermit ?? true;
      this.currentFarmState = data.currentFarmState || null;
      if (data.initialTankLevel !== undefined) {
        this.initialTankLevel = data.initialTankLevel;
      }
      if (data.initialFuelAmounts) {
        this.initialFuelAmounts = { ...data.initialFuelAmounts };
      }
      if (data.activeMissions) {
        this.activeMissions = [...data.activeMissions];
      }
      if (data.rawBackup) {
        this.rawBackup = data.rawBackup;
      }

      // Sync Fuel Tank Store
      const fuelTankStore = useFuelTankStore();
      fuelTankStore.tankLevel = this.initialTankLevel;
      fuelTankStore.fuelAmounts = { ...this.initialFuelAmounts };
    },

    /**
     * Set initial fuel amount
     */
    setInitialFuelAmount(egg: FuelEgg, amount: number) {
      this.initialFuelAmounts[egg] = Math.max(0, amount);
    },


    /**
     * Clear all initial state data
     */
    clear() {
      this.hasData = false;
      this.isContinuing = false;
      this.playerId = '';
      this.nickname = '';
      this.isUltra = false;
      this.lastBackupTime = 0;
      this.epicResearchLevels = initializeEpicResearchLevels();
      this.colleggtibleTiers = getDefaultColleggtibleTiers();
      this.artifactLoadout = createEmptyLoadout();
      this.artifactSets = { earnings: null, elr: null };
      this.activeArtifactSet = null;
      this.soulEggs = DEFAULT_SOUL_EGGS;
      this.prophecyEggs = 0;
      this.truthEggs = 0;
      this.assumeDoubleEarnings = true;
      this.researchCube = defaultResearchCube();
      this.proPermit = true;
      this.initialTankLevel = 0;
      this.initialFuelAmounts = createEmptyFuelAmounts();
    },
  },
});
