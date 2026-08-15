// Message shapes shared by the optimizer worker and its main-thread client. Structured clone drops
// prototypes: `ship` is a MissionType whose entire API is getters, so it is narrowed on the way out and rebuilt on the way in.

import { ei, MissionType } from 'lib';
import type { LaunchOption, LaunchSolution, OptimizerSolution, RecipeDAG } from './types';

export interface WireShip {
  shipType: ei.MissionInfo.Spaceship;
  durationType: ei.MissionInfo.DurationType;
}

export type WireLaunchOption = Omit<LaunchOption, 'ship'> & { ship: WireShip };
export type WireLaunchSolution = Omit<LaunchSolution, 'ship'> & { ship: WireShip };
export type WireSolution = Omit<OptimizerSolution, 'choiceHistory'> & { choiceHistory: WireLaunchSolution[] };

export interface OptimizerRequest {
  id: number;
  options: WireLaunchOption[];
  recipeDag: RecipeDAG;
  desiredArtifactNodeIds: string[];
  fuelCapacity: number;
  timeCapacityPerSlot: number;
  maximumCost: number | undefined;
  baseYield: Map<string, number>;
}

export type OptimizerResponse =
  | { id: number; ok: true; solutions: WireSolution[] }
  | { id: number; ok: false; error: string };

const toWireShip = (ship: MissionType): WireShip => ({
  shipType: ship.shipType,
  durationType: ship.durationType,
});

const fromWireShip = (ship: WireShip): MissionType => new MissionType(ship.shipType, ship.durationType);

export function optionsToWire(options: LaunchOption[]): WireLaunchOption[] {
  return options.map(o => ({ ...o, ship: toWireShip(o.ship) }));
}

export function optionsFromWire(options: WireLaunchOption[]): LaunchOption[] {
  return options.map(o => ({ ...o, ship: fromWireShip(o.ship) }));
}

export function solutionsToWire(solutions: OptimizerSolution[]): WireSolution[] {
  return solutions.map(s => ({
    ...s,
    choiceHistory: s.choiceHistory.map(c => ({ ...c, ship: toWireShip(c.ship) })),
  }));
}

export function solutionsFromWire(solutions: WireSolution[]): OptimizerSolution[] {
  return solutions.map(s => ({
    ...s,
    choiceHistory: s.choiceHistory.map(c => ({ ...c, ship: fromWireShip(c.ship) })),
  }));
}
