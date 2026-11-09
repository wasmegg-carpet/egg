/**
 * @module modes
 * @description Ascension Planner mode initialization system.
 *
 * IMPORTANT FOR AI & DEVELOPERS:
 * There are 5 distinct entry modes for an ascension. Each has strict state
 * contract requirements. BEFORE modifying any of these flows, you MUST
 * read the documentation in ./README.md to understand the isolation logic.
 *
 * Infrastructure:
 *   - fetchPlayerBackup: Pure data fetch, no store mutations
 *   - resetAllStores: Shared baseline reset for all modes
 *
 * Mode initializers:
 *   - initStartFromScratch: Mode A — full reset, no backup
 *   - initLoadPlan: Mode E — stores hydrated from saved plan
 *   - initPlanFuture: Mode B — backup for global progress, farm zeroed
 *   - initContinueCurrent: Mode C — backup with farm state carried forward
 *   - initReconcile: Mode D — backup for comparison, plan from library
 */

export { fetchPlayerBackup, type BackupResult } from './fetchBackup';
export { resetAllStores } from './reset';
export { initStartFromScratch } from './startFromScratch';
export { initLoadPlan } from './loadPlan';
export { initPlanFuture } from './planFuture';
export { initContinueCurrent } from './continueCurrent';
export { initReconcile, refreshReconcile } from './reconcile';
export * from './utils';
