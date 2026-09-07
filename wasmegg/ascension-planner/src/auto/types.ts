import type { Action } from '@/types/actions/meta';
import type { EngineState, SimulationContext } from '@/engine/types';
export type { EngineState, SimulationContext };
import type { VirtueEgg } from '@/types/actions/virtue';

export interface AscensionSummary {
  id: string;
  
  // Timing
  startTime: number;                      // Unix timestamp (seconds)
  endTime: number;                        // Unix timestamp (seconds)
  totalDurationSeconds: number;
  
  // Build phase info
  buildPhaseEndTime: number;              // When build phase ended (sale boundary)
  buildPhaseSaleCount: number;            // Which sale boundary was used

  // Time from ascension start to the end of H1 / start of K3 (the two coincide — K3 runs
  // immediately after H1). 0 for variants with no build phase (e.g. "continue current").
  buildDurationSeconds: number;

  // Key metrics at END of ascension
  startTE: number;
  endTE: number;
  teGained: number;
  maxELR: number;                         // Peak ELR after K3 purchases (eggs/second)
  maxEarningsRate: number;                // Peak ELR's money/second equivalent, at the ascension's final TE
  
  // SE tracking
  startSoulEggs: number;
  endSoulEggs: number;                    // After 12 shifts deducted (may be negative)
  startShiftCount: number;
  endShiftCount: number;                  // startShiftCount + 12
  totalShiftCost: number;                 // Sum of 12 shift costs
  
  // Per-egg summary
  eggsDelivered: Record<VirtueEgg, number>;
  teEarned: Record<VirtueEgg, number>;    // Gained during this ascension
  finalTE: Record<VirtueEgg, number>;     // Total after ascension
  
  // Time to earn the final TE step of the highest-TE egg
  lastTEDurationSeconds: number;

  // Strategy label for display
  strategyLabel: string;                  // e.g., "1-sale build, 20 TE"

  // Max ELR milestone flag
  isMaxELRAscension: boolean;             // True if this is the ~300 TE collapse

  // Whether Tier 13 research was unlocked by the end of this ascension (not just attempted).
  tier13Unlocked: boolean;
}

export interface AutoPlanGoal {
  targetTE: number;
}

export interface AutoPlanInput {
  backup: any;
  goal: AutoPlanGoal;
  startTime: number;
  timezone?: string;
}

export interface ShiftResult {
  actions: Action[];
  elapsedSeconds: number;
  endState: EngineState;
}

export interface BuildPhaseResult {
  actions: Action[];
  durationSeconds: number;
  endState: EngineState;
  maxELR: number;
}
