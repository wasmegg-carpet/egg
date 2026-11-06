import { defineStore } from 'pinia';
import type {
  InitialState,
  ResearchLevels,
  VirtueEgg,
  CurrentFarmState,
  ActiveMissionInfo,
} from '@/types';
import { ei, Mission } from 'lib';
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
  getOptimalEarningsSet,
  getOptimalELRSet,
} from '@/lib/artifacts';
import { parseVirtueFarm, parseVirtueProgress } from '@/lib/backupVirtue';
import { useTruthEggsStore, VIRTUE_TE_ORDER } from './truthEggs';
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

  // Current farm state (only if on a virtue egg)
  currentFarmState: CurrentFarmState | null;

  // Soul Eggs from backup
  soulEggs: number;

  // Assume double earnings (video doubler)
  assumeDoubleEarnings: boolean;

  // Pro permit (vs. Standard): Standard halves offline earnings, caps silos at 2 and active artifacts at 2
  proPermit: boolean;

  // Global progress metrics at start of ascension
  initialTankLevel: number;
  initialFuelAmounts: Record<VirtueEgg, number>;
  initialEggsDelivered: Record<VirtueEgg, number>;
  initialTeEarned: Record<VirtueEgg, number>;
  initialTePending: Record<VirtueEgg, number>;

  // Whether this is a continuation of an existing farm
  isContinuing: boolean;

  // Active missions from backup
  activeMissions: ei.IMissionInfo[];

  // Original backup data for re-calculating optimal sets
  rawBackup: ei.IBackup | null;
}

function createEmptyVirtueMap(): Record<VirtueEgg, number> {
  return {
    curiosity: 0,
    integrity: 0,
    humility: 0,
    resilience: 0,
    kindness: 0,
  };
}

/** Same artifacts and stones in every slot (missing slots count as empty). */
function sameLoadout(a: EquippedArtifact[], b: EquippedArtifact[]): boolean {
  const slot = (l: EquippedArtifact[], i: number) => JSON.stringify([l[i]?.artifactId ?? null, l[i]?.stones ?? []]);
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (slot(a, i) !== slot(b, i)) return false;
  return true;
}

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
    soulEggs: 1e21, // Default to 1s
    assumeDoubleEarnings: true,
    proPermit: true,
    initialTankLevel: 0,
    initialFuelAmounts: createEmptyVirtueMap(),
    initialEggsDelivered: createEmptyVirtueMap(),
    initialTeEarned: createEmptyVirtueMap(),
    initialTePending: createEmptyVirtueMap(),
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
     * Get active virtue missions from backup
     */
    virtueMissions(): ActiveMissionInfo[] {
      return this.activeMissions
        .map(m => new Mission(m))
        .filter(m => m.type === ei.MissionInfo.MissionType.VIRTUE)
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
      mode: 'scratch' | 'plan_next' | 'continue_earnings' | 'continue_elr' | 'reconcile' | 'default' = 'default'
    ): {
      initialShiftCount: number;
      initialTE: number;
      isUltra: boolean;
      tankLevel: number;
      virtueFuelAmounts: Record<VirtueEgg, number>;
      eggsDelivered: Record<VirtueEgg, number>;
      teEarnedPerEgg: Record<VirtueEgg, number>;
    } {
      this.hasData = true;
      this.isContinuing = mode === 'continue_earnings' || mode === 'continue_elr';
      this.rawBackup = backup;
      this.playerId = playerId;
      this.nickname = backup.userName || playerId;
      this.isUltra =
        backup.subInfo?.subscriptionLevel != null && backup.subInfo.status === ei.UserSubscriptionInfo.Status.ACTIVE;
      this.lastBackupTime = backup.settings?.lastBackupTime || backup.approxTime || 0;
      this.soulEggs = backup.game?.soulEggsD || 0;
      // Reconciling keeps the loaded plan's own permit: a plan runs on the permit it was built with.
      if (mode !== 'reconcile') this.proPermit = backup.game?.permitLevel === 1;

      const artifactsDB = backup.artifactsDb || {};
      this.activeMissions = [
        ...(artifactsDB.missionInfos || []),
        ...(artifactsDB.fuelingMission ? [artifactsDB.fuelingMission] : []),
        ...(artifactsDB.virtueAfxDb?.fuelingMission ? [artifactsDB.virtueAfxDb.fuelingMission] : []),
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

      // Handle artifact sets based on mode
      if (mode === 'scratch' || mode === 'plan_next') {
        const optimalEarnings = getOptimalEarningsSet(backup, this.proPermit);
        this.artifactSets.earnings = optimalEarnings;
        this.artifactSets.elr = null;
        this.setActiveArtifactSet('earnings');
      } else if (mode === 'continue_earnings') {
        this.artifactSets.earnings = backupLoadout;
        this.artifactSets.elr = null;
        this.setActiveArtifactSet('earnings');
      } else if (mode === 'continue_elr') {
        this.artifactSets.earnings = getOptimalEarningsSet(backup, this.proPermit);
        this.artifactSets.elr = backupLoadout;
        this.setActiveArtifactSet('elr');
      } else if (mode === 'reconcile') {
        // Do not update artifact sets from backup for reconcile
      } else {
        // Default behavior (e.g. initial load or form submit)
        const optimalEarnings = getOptimalEarningsSet(backup, this.proPermit);
        this.artifactSets.earnings = optimalEarnings;
        this.artifactSets.elr = JSON.parse(JSON.stringify(backupLoadout));
        this.setActiveArtifactSet('elr');
      }

      // Claimed TE, eggs delivered and pending TE per egg (lib/backupVirtue.ts)
      const { teEarned: teEarnedPerEgg, eggsDelivered, tePending: tePendingPerEgg } = parseVirtueProgress(backup);
      const initialTE = Object.values(teEarnedPerEgg).reduce((sum, val) => sum + val, 0);

      // Parse fuel tank data
      const tankLevel = backup.artifacts?.tankLevel ?? 0;
      const tankFuels = backup.virtue?.afx?.tankFuels ?? [];

      // Virtue egg fuel amounts are at indices 20-24:
      // [Curiosity, Integrity, Humility, Resilience, Kindness]
      const virtueFuelAmounts: Record<VirtueEgg, number> = {
        curiosity: tankFuels[20] ?? 0,
        integrity: tankFuels[21] ?? 0,
        humility: tankFuels[22] ?? 0,
        resilience: tankFuels[23] ?? 0,
        kindness: tankFuels[24] ?? 0,
      };
      this.initialTankLevel = tankLevel;
      this.initialFuelAmounts = { ...virtueFuelAmounts };
      this.initialEggsDelivered = { ...eggsDelivered };
      this.initialTeEarned = { ...teEarnedPerEgg };

      this.initialTePending = { ...tePendingPerEgg };

      // Load current farm state if on a virtue egg (IDs 50-54)
      this.currentFarmState = parseVirtueFarm(backup);

      // Return virtue and tank data
      return {
        initialShiftCount: backup.virtue?.shiftCount ?? 0,
        initialTE,
        isUltra: this.isUltra,
        tankLevel,
        virtueFuelAmounts,
        eggsDelivered,
        teEarnedPerEgg: teEarnedPerEgg,
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
      this.soulEggs = count;
    },

    /**
     * Set assume double earnings
     */
    setAssumeDoubleEarnings(enabled: boolean) {
      this.assumeDoubleEarnings = enabled;
    },

    /**
     * Set Pro vs. Standard permit. An earnings set that is still the optimizer's pick for the old
     * permit is re-picked for the new one (Standard's best 2 aren't simply the first 2 of Pro's 4);
     * a set the player edited is kept as is.
     */
    setProPermit(enabled: boolean) {
      if (enabled === this.proPermit) return;
      const backup = this.rawBackup;
      const earnings = this.artifactSets.earnings;
      if (backup && earnings && sameLoadout(earnings, getOptimalEarningsSet(backup, this.proPermit))) {
        this.updateArtifactSet('earnings', getOptimalEarningsSet(backup, enabled));
      }
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
      this.soulEggs = data.soulEggs || 1e21;

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
        this.activeArtifactSet = 'elr';
      }
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
      if (data.initialEggsDelivered) {
        this.initialEggsDelivered = { ...data.initialEggsDelivered };
      }
      if (data.initialTeEarned) {
        this.initialTeEarned = { ...data.initialTeEarned };
      }
      if (data.initialTePending) {
        this.initialTePending = { ...data.initialTePending };
      }
      if (data.activeMissions) {
        this.activeMissions = [...data.activeMissions];
      }
      if (data.rawBackup) {
        this.rawBackup = data.rawBackup;
      }

      // Sync Truth Eggs Store
      const truthEggsStore = useTruthEggsStore();
      truthEggsStore.eggsDelivered = { ...this.initialEggsDelivered };
      truthEggsStore.teEarned = { ...this.initialTeEarned };

      // Sync Fuel Tank Store
      const fuelTankStore = useFuelTankStore();
      fuelTankStore.tankLevel = this.initialTankLevel;
      fuelTankStore.fuelAmounts = { ...this.initialFuelAmounts };
    },

    /**
     * Set initial fuel amount
     */
    setInitialFuelAmount(egg: VirtueEgg, amount: number) {
      this.initialFuelAmounts[egg] = Math.max(0, amount);
    },

    /**
     * Set initial eggs delivered
     */
    setInitialEggsDelivered(egg: VirtueEgg, amount: number) {
      this.initialEggsDelivered[egg] = Math.max(0, amount);
    },

    /**
     * Set initial TE earned
     */
    setInitialTeEarned(egg: VirtueEgg, count: number) {
      this.initialTeEarned[egg] = Math.max(0, Math.min(98, count));
    },

    /**
     * Set initial TE pending
     */
    setInitialTePending(egg: VirtueEgg, count: number) {
      this.initialTePending[egg] = Math.max(0, count);
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
      this.soulEggs = 1e21;
      this.assumeDoubleEarnings = true;
      this.proPermit = true;
      this.initialTankLevel = 0;
      this.initialFuelAmounts = createEmptyVirtueMap();
      this.initialEggsDelivered = createEmptyVirtueMap();
      this.initialTeEarned = createEmptyVirtueMap();
      this.initialTePending = createEmptyVirtueMap();
    },
  },
});
