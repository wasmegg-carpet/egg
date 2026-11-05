/**
 * Message protocol shared between the main thread (useResearchCalcWorker.ts) and
 * researchCalc.worker.ts — the four heavy research-plan simulations behind the Milestones and
 * Smart Buy views (milestone chain, 70% Return, Buy Until Sale Ends, Quick Buy), moved off the main
 * thread so a large one can't trip Chrome's "Page Unresponsive" hang detector (that only watches
 * the main thread — see useResearchCalcWorker.ts's doc comment).
 *
 * One request type per computation kind rather than a generic "run this function" message: each
 * carries exactly the plain, already-Pinia-resolved inputs its `calculations/*` function needs
 * (built on the main thread, same as before — see researchCalc.worker.ts's own doc comment for why
 * that part can't move into the worker), so there's nothing worker-side to interpret beyond a
 * `switch` on `kind`.
 */
import type { CalculationsSnapshot } from '@/types';
import type { SimulationContext } from '@/engine/types';
import type { ResearchCostModifiers } from '@/calculations/commonResearch';
import type { MilestoneTarget, MilestoneChainResult } from '@/calculations/milestoneChain';
import type { SaleAwareBuyPlan, SaleEndsPlan, SimpleBuyPlan } from '@/calculations/smartBuyPreview';
import type { ei } from 'lib';

export interface MilestoneChainRequest {
  kind: 'milestoneChain';
  /** Identifies this request/response pair on a worker shared by all four kinds — lets a response
   *  be routed back to the caller that's actually still waiting on it (see
   *  useResearchCalcWorker.ts's `pending` map) and, for a stray response with no matching entry
   *  (already handled some other way), safely ignored. Not a substitute for each watchEffect's own
   *  generation-based staleness check in useResearchViews.ts — that decides whether a *successful*
   *  result should still be used; this only decides where it goes. */
  requestId: number;
  target: MilestoneTarget;
  startSnapshot: CalculationsSnapshot;
  context: SimulationContext;
  mods: ResearchCostModifiers;
  absoluteSimTime: number;
  deadline: number;
}

export interface SaleAwareBuyRequest {
  kind: 'saleAwareBuy';
  requestId: number;
  researchLevels: Record<string, number>;
  startSnapshot: CalculationsSnapshot;
  context: SimulationContext;
  mods: ResearchCostModifiers;
  absoluteSimTime: number;
  deadline: number;
  nextSaleStart: number;
  roiMode: 'immediate' | 'maxed_vehicles';
  deliveryImpactOnly: boolean;
  // Forwarded to `simulateSaleAwareBuy`'s own `fullRoiDeadline` — see its doc comment. The "how many
  // sales are in play" target (manual planner's sale-count picker, or C3's `buildPhaseEnd`).
  fullRoiDeadline: number;
}

export interface SaleEndsBuyRequest {
  kind: 'saleEndsBuy';
  requestId: number;
  researchLevels: Record<string, number>;
  startSnapshot: CalculationsSnapshot;
  context: SimulationContext;
  mods: ResearchCostModifiers;
  absoluteSimTime: number;
  deadline: number;
  elrViewMode: 'realistic' | 'potential';
  elrSortMode: 'efficiency' | 'impact';
  /** protobufjs-decoded — see researchCalc.worker.ts for why this gets Long-sanitized on receipt. */
  rawBackup: ei.IBackup | null | undefined;
}

export interface ThresholdBuyRequest {
  kind: 'thresholdBuy';
  requestId: number;
  researchLevels: Record<string, number>;
  startSnapshot: CalculationsSnapshot;
  context: SimulationContext;
  mods: ResearchCostModifiers;
  isSale: boolean;
  thresholdSeconds: number;
}

export type WorkerRequest = MilestoneChainRequest | SaleAwareBuyRequest | SaleEndsBuyRequest | ThresholdBuyRequest;

export interface WorkerResultMessage {
  type: 'result';
  requestId: number;
  result: MilestoneChainResult | SaleAwareBuyPlan | SaleEndsPlan | SimpleBuyPlan;
}

export interface WorkerErrorMessage {
  type: 'error';
  requestId: number;
  message: string;
}

export type WorkerResponse = WorkerResultMessage | WorkerErrorMessage;
