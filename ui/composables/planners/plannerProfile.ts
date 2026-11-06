import { inject, type InjectionKey } from 'vue';
import type { PlannerProfile } from 'lib/planners/profile';

/** Provide with `app.provide(PLANNER_PROFILE_KEY, PROFILE)` in the planner's main.ts. */
export const PLANNER_PROFILE_KEY: InjectionKey<PlannerProfile> = Symbol('plannerProfile');

/** The current planner's profile, for shared components. */
export function usePlannerProfile(): PlannerProfile {
  const profile = inject(PLANNER_PROFILE_KEY);
  if (!profile) throw new Error('No planner profile provided (see PLANNER_PROFILE_KEY)');
  return profile;
}
