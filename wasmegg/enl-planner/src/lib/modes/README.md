# Enlightenment Planner: Mode Initialization

There are 5 ways to enter a plan. Each has an initializer in `src/lib/modes/`, and each starts by
calling `resetAllStores()`.

1. **Start from Scratch** (`initStartFromScratch`): No backup data. Complete reset to defaults.
2. **Plan New Enlightenment Farm** (`initPlanFuture`): Uses global progress from a fresh backup (epic
   research, artifacts, SE, PE, TE, fuel) but zeroes the farm (research, habs, vehicles, silos, bank).
3. **Continue Enlightenment Farm** (`initContinueCurrent`): Carries the enlightenment farm in the backup
   into the plan. Fails with a message when the save isn't on the Enlightenment egg.
4. **Reconcile** (`initReconcile`): Compares a saved plan against a fresh backup.
5. **Load Saved Plan** (`initLoadPlan`): Hydrates all stores from a saved plan's serialized state.

Reconcile keeps the plan's permit, artifact sets and notes: a plan runs on what it was built with.
