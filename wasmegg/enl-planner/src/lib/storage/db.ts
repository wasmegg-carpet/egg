/**
 * @module StorageDB
 * @description The Enlightenment Planner's IndexedDB database (lib/planners/storage/db.ts).
 */

import { createPlannerDb } from 'lib/planners/storage/db';

export { hashID, type PlanData } from 'lib/planners/storage/db';

export const { savePlanToLibrary, loadLibraryPlans, deletePlanFromLibrary, saveMetadata, loadMetadata } =
  createPlannerDb('EnlightenmentPlannerDB');
