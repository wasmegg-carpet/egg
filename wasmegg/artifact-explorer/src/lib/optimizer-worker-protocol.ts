// Message shapes shared by the optimizer worker and its main-thread client. Structured clone drops
// prototypes: `ship` is a MissionType whose entire API is getters, so it is narrowed on the way out and rebuilt on the way in.

import { ei, MissionType } from 'lib';
import type { OptimizeArgs } from './optimizer-core';
import type { LaunchOption, LaunchSolution, OptimizerSolution } from './types';

export interface WireShip {
  shipType: ei.MissionInfo.Spaceship;
  durationType: ei.MissionInfo.DurationType;
}

export type WireLaunchOption = Omit<LaunchOption, 'ship'> & { ship: WireShip };
export type WireLaunchSolution = Omit<LaunchSolution, 'ship'> & { ship: WireShip };
export type WireSolution = Omit<OptimizerSolution, 'choiceHistory'> & { choiceHistory: WireLaunchSolution[] };

// The solve's own arguments, with only `options` narrowed: everything else in `OptimizeArgs` is plain
// data (numbers, arrays and Maps) that structured clone carries intact, so it needs no
// narrow/reconstruct pair the way `ship` does.
export type WireOptimizeArgs = Omit<OptimizeArgs, 'options'> & { options: WireLaunchOption[] };

// The id is the protocol's own, so it sits beside the arguments rather than among them — the worker
// then forwards `args` whole, and a new solver argument needs no edit here.
export interface OptimizerRequest {
  id: number;
  args: WireOptimizeArgs;
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
