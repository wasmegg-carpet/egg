import { trimTrailingZeros } from '@/lib';
import { ei, MissionType } from 'lib';

export function missionDurationTypeFgClass(mission: MissionType): string {
  switch (mission.durationType) {
    case ei.MissionInfo.DurationType.TUTORIAL:
    case ei.MissionInfo.DurationType.SHORT:
      return 'text-blue-500';
    case ei.MissionInfo.DurationType.LONG:
      return 'text-purple-500';
    case ei.MissionInfo.DurationType.EPIC:
      return 'text-yellow-500';
    default:
      return '';
  }
}

export function missionDurationTypeBgClass(mission: MissionType): string {
  switch (mission.durationType) {
    case ei.MissionInfo.DurationType.TUTORIAL:
    case ei.MissionInfo.DurationType.SHORT:
      return 'bg-blue-500';
    case ei.MissionInfo.DurationType.LONG:
      return 'bg-purple-500';
    case ei.MissionInfo.DurationType.EPIC:
      return 'bg-yellow-500';
    default:
      return '';
  }
}

export enum RoundingMode {
  Down = -1,
  Nearest = 0,
  Up = 1,
}

export function formatWithThousandSeparators(x: number, roundingMode = RoundingMode.Nearest): string {
  let rounded: number;
  switch (roundingMode) {
    case RoundingMode.Down:
      rounded = Math.floor(x);
      break;
    case RoundingMode.Nearest:
      rounded = Math.round(x);
      break;
    case RoundingMode.Up:
      rounded = Math.ceil(x);
      break;
  }
  return rounded.toLocaleString('en-US');
}

export function formatPercentage(x: number, maxDecimals = 2): string {
  const s = (x * 100).toFixed(maxDecimals);
  return trimTrailingZeros(s) + '%';
}
