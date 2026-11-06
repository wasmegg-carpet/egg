import type { Action, BuyResearchPayload, StartAscensionPayload } from '@/types';
import { getResearchById, TIER_UNLOCK_THRESHOLDS } from '@/calculations/commonResearch';
import { computeDependencies } from '@/lib/actions/executor';

/**
 * Re-build the dependency graph for all actions.
 */
export function relinkDependenciesLogic(actions: Action[], initialResearchLevels: Record<string, number> = {}) {
  // 1. Create a map for fast lookups and clear existing linkages
  const actionMap = new Map<string, Action>();
  for (const action of actions) {
    actionMap.set(action.id, action);
    action.dependsOn = [];
    action.dependents = [];
  }

  // 2. Recompute and build
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const existingActions = actions.slice(0, i);

    action.dependsOn = computeDependencies(action.type, action.payload, existingActions, initialResearchLevels);

    for (const depId of action.dependsOn) {
      const depAction = actionMap.get(depId);
      if (depAction) {
        depAction.dependents.push(action.id);
      }
    }
  }
}

/**
 * Find all actions requiring removal due to dependencies.
 */
export function getActionsRequiringRemovalLogic(
  actions: Action[],
  initialIds: Set<string>,
  initialResearchLevels: Record<string, number> = {}
): Action[] {
  const toRemove = new Set<string>(initialIds);
  let changed = true;

  while (changed) {
    changed = false;
    const currentCount = toRemove.size;

    // 1. Explicit dependents
    for (const action of actions) {
      if (toRemove.has(action.id)) continue;
      for (const depId of action.dependsOn) {
        if (toRemove.has(depId)) {
          toRemove.add(action.id);
          break;
        }
      }
    }

    // 2. Tier locks
    const purchasesByTier = new Array(15).fill(0);
    // Initialize with initialResearchLevels
    for (const [id, level] of Object.entries(initialResearchLevels)) {
      const research = getResearchById(id);
      if (research) {
        purchasesByTier[research.tier] = (purchasesByTier[research.tier] || 0) + level;
      }
    }

    const sortedActions = [...actions].sort((a, b) => a.index - b.index);

    for (const action of sortedActions) {
      if (toRemove.has(action.id)) continue;
      if (action.type === 'buy_research') {
        const payload = action.payload as BuyResearchPayload;
        const research = getResearchById(payload.researchId);
        if (research && research.tier > 1) {
          const threshold = TIER_UNLOCK_THRESHOLDS[research.tier - 1];
          let purchasesBelow = 0;
          for (let t = 1; t < research.tier; t++) {
            purchasesBelow += purchasesByTier[t] || 0;
          }

          if (purchasesBelow < threshold) {
            toRemove.add(action.id);
            continue;
          }
        }
        // Update purchasesByTier after checking threshold
        if (research) {
          purchasesByTier[research.tier] =
            (purchasesByTier[research.tier] || 0) + (payload.toLevel - payload.fromLevel);
        }
      } else if (action.type === 'start_ascension') {
        const payload = action.payload as StartAscensionPayload;
        if (payload.initialFarmState?.commonResearches) {
          for (const [id, level] of Object.entries(payload.initialFarmState.commonResearches)) {
            const research = getResearchById(id);
            if (research) {
              purchasesByTier[research.tier] = (purchasesByTier[research.tier] || 0) + (level as number);
            }
          }
        }
      }
    }

    if (toRemove.size > currentCount) changed = true;
  }

  return actions.filter(a => toRemove.has(a.id)).sort((a, b) => a.index - b.index);
}

/**
 * Get all actions that depend on a given action (recursive).
 */
export function collectDependentActions(actions: Action[], actionId: string): Action[] {
  const result: Action[] = [];
  const visited = new Set<string>();

  const collect = (id: string) => {
    const action = actions.find(a => a.id === id);
    if (!action || visited.has(id)) return;
    visited.add(id);

    for (const depId of action.dependents) {
      const depAction = actions.find(a => a.id === depId);
      if (depAction && !visited.has(depId)) {
        result.push(depAction);
        collect(depId);
      }
    }
  };

  collect(actionId);
  return result.sort((a, b) => a.index - b.index);
}
