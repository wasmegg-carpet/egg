/**
 * Launch Missions Action Executor
 *
 * Records mission launches. Fuel deduction is handled by the component
 * (normal flow) and by replay.ts (replay flow).
 */

import { getTargetName } from 'lib';

import type { ActionExecutor } from '../executor';
import type { LaunchMissionEntry, LaunchMissionsPayload } from '@/types';
import { SHIP_INFO, DURATION_NAMES, type Spaceship, type DurationType } from '@/lib/missions';
import { formatDuration } from '@/lib/format';

// Only an imported plan aims a launch at anything; one built by hand in the mission grid carries no
// target and makes no claim about one, so it says nothing rather than "untargeted".
function targetLabel(entry: LaunchMissionEntry): string {
  if (entry.targetAfxId === undefined) return '';
  return ` → ${getTargetName(entry.targetAfxId)}`;
}

export const launchMissionsExecutor: ActionExecutor<'launch_missions'> = {
  execute(_payload: LaunchMissionsPayload): number {
    // Fuel deduction is handled directly by the component and replay
    return 0;
  },

  getDisplayName(payload: LaunchMissionsPayload): string {
    const total = payload.totalMissions;
    return `Launch ${total} mission${total !== 1 ? 's' : ''}`;
  },

  getEffectDescription(payload: LaunchMissionsPayload): string {
    const parts: string[] = [];
    for (const m of payload.missions) {
      const shipName = SHIP_INFO[m.ship as Spaceship]?.displayName ?? 'Unknown';
      const durName = DURATION_NAMES[m.duration as DurationType] ?? 'Unknown';
      parts.push(`${m.count}× ${durName} ${shipName}${targetLabel(m)}`);
    }
    const summary = parts.join(', ');
    const timeStr = payload.totalTimeSeconds === 0 ? '0s (Pre-shift)' : formatDuration(payload.totalTimeSeconds);
    return `${summary} (${timeStr})`;
  },
};
