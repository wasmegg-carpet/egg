import { allMissionTypes, ei } from '../index';
import DurationType = ei.MissionInfo.DurationType;

export const missions = allMissionTypes.filter(m => m.durationType !== DurationType.TUTORIAL);
