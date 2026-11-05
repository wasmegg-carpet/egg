/**
 * Epic Research definitions.
 * Epic research is permanent and purchased with Golden Eggs.
 */

export interface EpicResearchDef {
  id: string;
  name: string;
  effect: string;
  maxLevel: number;
}

/**
 * All epic research definitions from the game.
 */
export const epicResearchDefs: EpicResearchDef[] = [
  { id: 'hold_to_hatch', name: 'Hold to Hatch', effect: '+2 chickens/sec when holding', maxLevel: 15 },
  { id: 'epic_hatchery', name: 'Epic Hatchery', effect: '+10% hatchery refill', maxLevel: 20 },
  { id: 'epic_internal_incubators', name: 'Epic Int. Hatcheries', effect: '+5% IHR (multiplicative)', maxLevel: 20 },
  { id: 'video_doubler_time', name: 'Video Doubler Time', effect: '+30 min video doubler', maxLevel: 12 },
  { id: 'epic_clucking', name: 'Epic Clucking', effect: '+0.1% RCB per chicken', maxLevel: 20 },
  { id: 'epic_multiplier', name: 'Epic Multiplier', effect: '+2x max RCB', maxLevel: 100 },
  { id: 'cheaper_contractors', name: 'Cheaper Contractors', effect: '-5% hab build cost', maxLevel: 10 },
  { id: 'bust_unions', name: 'Bust Unions', effect: '-5% vehicle hire cost', maxLevel: 10 },
  { id: 'cheaper_research', name: 'Lab Upgrade', effect: '-5% research cost', maxLevel: 10 },
  { id: 'silo_capacity', name: 'Silo Capacity', effect: '+6 min away time/silo', maxLevel: 20 },
  { id: 'int_hatch_sharing', name: 'Internal Hatchery Sharing', effect: '+10% full hab sharing', maxLevel: 10 },
  { id: 'int_hatch_calm', name: 'Internal Hatchery Calm', effect: '+10% IHR while away', maxLevel: 20 },
  { id: 'accounting_tricks', name: 'Accounting Tricks', effect: '+5% farm valuation', maxLevel: 20 },
  { id: 'soul_eggs', name: 'Soul Food', effect: '+1% SE bonus', maxLevel: 140 },
  { id: 'prestige_bonus', name: 'Prestige Bonus', effect: '+10% SE on prestige', maxLevel: 20 },
  { id: 'drone_rewards', name: 'Drone Rewards', effect: '+10% better drone rewards', maxLevel: 20 },
  { id: 'epic_egg_laying', name: 'Epic Comfy Nests', effect: '+5% egg laying rate', maxLevel: 20 },
  { id: 'transportation_lobbyist', name: 'Transportation Lobbyists', effect: '+5% shipping capacity', maxLevel: 30 },
  { id: 'prophecy_bonus', name: 'Prophecy Bonus', effect: '+1% PE bonus (compound)', maxLevel: 5 },
  { id: 'hold_to_research', name: 'Hold to Research', effect: '+25% research button speed', maxLevel: 20 },
  { id: 'afx_mission_time', name: 'FTL Drive Upgrades', effect: '-1% mission time', maxLevel: 60 },
  { id: 'afx_mission_capacity', name: 'Zero-g Quantum Containment', effect: '+5% mission capacity', maxLevel: 10 },
];

/**
 * Map of epic research ID to definition for quick lookup.
 */
export const epicResearchById = new Map<string, EpicResearchDef>(epicResearchDefs.map(r => [r.id, r]));

/**
 * Get epic research definition by ID.
 */
export function getEpicResearchDef(id: string): EpicResearchDef | undefined {
  return epicResearchById.get(id);
}
