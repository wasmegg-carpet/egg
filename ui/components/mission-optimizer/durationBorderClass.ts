import { ei } from 'lib';

import DurationType = ei.MissionInfo.DurationType;

export function durationBorderClass(durationType: DurationType) {
  switch (durationType) {
    case DurationType.SHORT:
      return 'border-blue-500';
    case DurationType.LONG:
      return 'border-purple-500';
    case DurationType.EPIC:
      return 'border-yellow-500';
    default:
      return '';
  }
}
