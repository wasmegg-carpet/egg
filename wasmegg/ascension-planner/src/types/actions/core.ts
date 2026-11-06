import type { VirtueEgg } from './virtue';

/**
 * Payload for starting an ascension (initial state).
 */
export interface StartAscensionPayload {
  initialEgg: VirtueEgg;
  initialFarmState?: import('../index').CurrentFarmState;
  isQuickContinue?: boolean;
}

/**
 * Payload for shifting to a different virtue egg.
 */
export interface ShiftPayload {
  fromEgg: VirtueEgg;
  toEgg: VirtueEgg;
  newShiftCount: number;
  /** The auto planner's name for the shift this action starts (e.g. 'K1', 'C3'). The opening's
   * C1/K1/I1 rounds repeat and K1 can be skipped, so a shift's name can't be derived from its
   * position in the plan. Used to find planner phases (e.g. C3/K3 for the comparison charts);
   * shift headers in the UI are numbered by egg visit instead. */
  autoShiftName?: string;
  eggsLaid?: number;
  peakELR?: number;
}

import type {
  BuyVehiclePayload,
  BuyHabPayload,
  BuyTrainCarPayload,
  BuySiloPayload,
  StoreFuelPayload,
  RemoveFuelPayload,
} from './infrastructure';
import type { BuyResearchPayload, ToggleSalePayload, ToggleEarningsBoostPayload } from 'lib/planners/types/actions/research';
import type { LaunchMissionsPayload, WaitForMissionsPayload } from './missions';
import type { WaitForTEPayload, WaitForTimePayload, WaitForFullHabsPayload, WaitForGemsPayload } from './wait';
import type {
  EggValueOutput,
  HabCapacityOutput,
  LayRateOutput,
  ShippingCapacityOutput,
  EffectiveLayRateOutput,
  EarningsOutput,
  IHROutput,
} from '../index';
import type { BaseCalculationsSnapshot, ModifyBankPayload, NotificationPayload } from 'lib/planners/types/actions/core';
export type { BaseCalculationsSnapshot, ModifyBankPayload, NotificationPayload } from 'lib/planners/types/actions/core';

/**
 * Union of all action types.
 */
export type ActionType =
  | 'start_ascension'
  | 'buy_vehicle'
  | 'buy_hab'
  | 'buy_research'
  | 'shift'
  | 'buy_train_car'
  | 'change_artifacts'
  | 'buy_silo'
  | 'store_fuel'
  | 'remove_fuel'
  | 'wait_for_te'
  | 'launch_missions'
  | 'toggle_sale'
  | 'equip_artifact_set'
  | 'update_artifact_set'
  | 'wait_for_missions'
  | 'wait_for_time'
  | 'wait_for_full_habs'
  | 'wait_for_gems'
  | 'wait_for_research_sale'
  | 'wait_for_research_sale_end'
  | 'wait_for_earnings_boost'
  | 'wait_for_earnings_boost_end'
  | 'wait_for_no_earnings'
  | 'toggle_earnings_boost'
  | 'notification'
  | 'modify_bank';

/**
 * Maps action types to their payload interfaces.
 */
export interface ActionPayloadMap {
  start_ascension: StartAscensionPayload;
  buy_vehicle: BuyVehiclePayload;
  buy_hab: BuyHabPayload;
  buy_research: BuyResearchPayload;
  shift: ShiftPayload;
  buy_train_car: BuyTrainCarPayload;
  change_artifacts: import('lib/planners/types/actions/artifacts').ChangeArtifactsPayload;
  buy_silo: BuySiloPayload;
  store_fuel: StoreFuelPayload;
  remove_fuel: RemoveFuelPayload;
  wait_for_te: WaitForTEPayload;
  launch_missions: LaunchMissionsPayload;
  toggle_sale: ToggleSalePayload;
  equip_artifact_set: import('lib/planners/types/actions/artifacts').EquipArtifactSetPayload;
  update_artifact_set: import('lib/planners/types/actions/artifacts').UpdateArtifactSetPayload;
  wait_for_missions: WaitForMissionsPayload;
  wait_for_time: WaitForTimePayload;
  wait_for_full_habs: WaitForFullHabsPayload;
  wait_for_gems: WaitForGemsPayload;
  wait_for_research_sale: import('./wait').WaitForResearchSalePayload;
  wait_for_research_sale_end: import('./wait').WaitForResearchSaleEndPayload;
  wait_for_earnings_boost: import('./wait').WaitForEarningsBoostPayload;
  wait_for_earnings_boost_end: import('./wait').WaitForEarningsBoostEndPayload;
  wait_for_no_earnings: import('./wait').WaitWithoutEarningsPayload;
  toggle_earnings_boost: ToggleEarningsBoostPayload;
  notification: NotificationPayload;
  modify_bank: ModifyBankPayload;
}

/**
 * Snapshot of all calculation outputs at a point in time.
 */
export interface CalculationsSnapshot extends BaseCalculationsSnapshot {
  currentEgg: VirtueEgg;
  shiftCount: number;
  fuelTankAmounts: Record<VirtueEgg, number>;
  eggsDelivered: Record<VirtueEgg, number>;
  teEarned: Record<VirtueEgg, number>;
  fullOutputs?: CalculationsFullOutputs;
}

/**
 * Full calculation outputs for detailed modal display.
 */
export interface CalculationsFullOutputs {
  eggValue: EggValueOutput;
  habCapacity: HabCapacityOutput;
  layRate: LayRateOutput;
  shippingCapacity: ShippingCapacityOutput;
  elr: EffectiveLayRateOutput;
  earnings: EarningsOutput;
  ihr: IHROutput;
}
