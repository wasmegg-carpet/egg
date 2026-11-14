import { epicResearchDefs } from '../epicResearch';
import type { Mission } from '../../index';
import type { ResearchLevels } from '../types';
import type { ArtifactSetName } from '@planner/types';
import { createEmptyLoadout, type EquippedArtifact } from '@planner/lib/artifacts';
import { getDefaultColleggtibleTiers } from '../../collegtibles';

/** The part of the initialState store both planners share. */
export interface SharedInitialState {
  epicResearchLevels: ResearchLevels;
  colleggtibleTiers: Record<string, number>;
  artifactLoadout: EquippedArtifact[];
  artifactSets: Record<ArtifactSetName, EquippedArtifact[] | null>;
  activeArtifactSet: ArtifactSetName | null;
}

/** Store actions both planners' initialState stores include. */
export const sharedInitialStateActions = {
  /**
   * Set epic research level
   */
  setEpicResearchLevel(this: SharedInitialState, researchId: string, level: number) {
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
  setColleggtibleTier(this: SharedInitialState, id: string, tierIndex: number) {
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
  setArtifactLoadout(this: SharedInitialState, loadout: EquippedArtifact[]) {
    this.artifactLoadout = loadout;
  },

  /**
   * Set active artifact set and update current loadout
   */
  setActiveArtifactSet(this: SharedInitialState, setName: ArtifactSetName | null) {
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
  updateArtifactSet(this: SharedInitialState, setName: ArtifactSetName, loadout: EquippedArtifact[]) {
    this.artifactSets[setName] = JSON.parse(JSON.stringify(loadout));
    // If updating the active set, also update current loadout
    if (this.activeArtifactSet === setName) {
      this.artifactLoadout = JSON.parse(JSON.stringify(loadout));
    }
  },

  /**
   * Save current loadout to a set
   */
  saveCurrentToSet(this: SharedInitialState, setName: ArtifactSetName) {
    this.artifactSets[setName] = JSON.parse(JSON.stringify(this.artifactLoadout));
    this.activeArtifactSet = setName;
  },
};

/** Copies the saved fields both planners store. */
export function hydrateSharedInitialState(
  store: SharedInitialState,
  data: Partial<Pick<SharedInitialState, 'epicResearchLevels' | 'colleggtibleTiers' | 'artifactLoadout' | 'artifactSets' | 'activeArtifactSet'>>
): void {
  if (data.epicResearchLevels) {
    store.epicResearchLevels = { ...data.epicResearchLevels };
  }
  if (data.colleggtibleTiers) {
    // Merge onto current defaults rather than replacing outright, so
    // colleggtibles released after this plan was saved (and therefore
    // absent from the saved data) still get an entry instead of being
    // silently dropped and unsettable in the UI.
    store.colleggtibleTiers = {
      ...getDefaultColleggtibleTiers(),
      ...data.colleggtibleTiers,
    };
  }
  if (data.artifactLoadout) {
    store.artifactLoadout = [...data.artifactLoadout];
  }
  if (data.artifactSets) {
    store.artifactSets = { ...data.artifactSets };
  }
  if (data.activeArtifactSet !== undefined) {
    store.activeArtifactSet = data.activeArtifactSet;
  }
}

/** What the Missions tab needs from an active mission. */
export function toActiveMissionInfo(m: Mission) {
  return {
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
  };
}
