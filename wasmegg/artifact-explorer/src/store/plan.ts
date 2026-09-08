// State for planning an ascension cycle's Humility visits from a loaded ascension-planner save.
//
// Two things live here that the rest of the store does not have to know about: the plan itself,
// which persists across reloads because re-picking the file every time would make a multi-visit
// cycle unusable, and the visit currently selected on it, which is what lets the optimizer's
// existing `effective*` refs read that visit's budgets instead of the loaded save's. The selection
// persists with the plan: coming back to the tab mid-cycle should land where the work stopped.
//
// Solved visits are kept as the *projection* that gets exported, never as an `OptimizerSolution`:
// that type is full of `Map`s, which `JSON.stringify` renders as `{}`.

import { computed, ref } from 'vue';

import { ei, formatDuration, getLocalStorage, parseDurationDays, setLocalStorage } from 'lib';

import type { HumilityVisit } from '@/lib/plan/read';
import type { HumilityPlanVisit } from '@/lib/plan/schema';

const PLAN_LOCALSTORAGE_KEY = 'humility_plan';

// Bumped when the persisted shape changes. A mismatch discards rather than migrates: the plan is
// one file re-pick away, and a half-understood blob would solve against budgets nobody can see.
const PLAN_STORE_VERSION = 1;

// What the optimizer is allowed to burn at a visit. `banked` is the per-egg amount the plan says
// is in the tank on arrival. `full-tank` is the tank's whole capacity as one pooled budget, split
// across the eggs however the answer needs — for a plan that has not scheduled its fuel yet, which
// is what makes the exported `fuelRequired` a statement of what it still has to go store.
export type VisitFuelBudget = 'banked' | 'full-tank';

export interface VisitSettings {
  // Artifact node ids the optimizer should aim at for this visit.
  targetIds: string[];
  // Null means "use the duration the plan itself spends on Humility here". A plan that has not
  // scheduled this visit's missions yet reports zero, so the page takes a typed value instead.
  waitTimeOverride: string | null;
  fuelBudget: VisitFuelBudget;
}

export interface LoadedPlan {
  label: string;
  loadedAt: number;
  visits: HumilityVisit[];
  // The visit the optimizer is pointed at, or null for the off-plan entry, which budgets against
  // the loaded save exactly as the page does with no plan at all.
  currentVisitId: string | null;
  settings: Record<string, VisitSettings>;
  solved: Record<string, HumilityPlanVisit>;
}

function newVisitSettings(): VisitSettings {
  return {
    targetIds: [],
    waitTimeOverride: null,
    // The plan's own numbers, until the player says otherwise.
    fuelBudget: 'banked',
  };
}

export const loadedPlan = ref<LoadedPlan | null>(loadPlan());

export const activePlanVisit = computed<HumilityVisit | null>(() => {
  const plan = loadedPlan.value;
  if (!plan || plan.currentVisitId === null) return null;
  return plan.visits.find(v => v.visitId === plan.currentVisitId) ?? null;
});

export function setLoadedPlan(label: string, visits: HumilityVisit[]): void {
  // A freshly loaded plan starts off-plan: the file says nothing about which visit the player came
  // here to solve, and guessing one would silently swap the budgets under a selection they made
  // before loading it.
  loadedPlan.value = { label, loadedAt: Date.now(), visits, currentVisitId: null, settings: {}, solved: {} };
  persistPlan();
}

// Selecting a visit repoints the one target selector on the page at that visit's saved targets. A
// visit that has none yet takes whatever is already selected: loading the plan after picking
// targets is the expected order, and dropping them would empty the page the plan lives on.
export function setCurrentVisit(visitId: string | null, seedTargets: readonly string[] = []): void {
  const plan = loadedPlan.value;
  if (!plan) return;
  plan.currentVisitId = visitId;
  if (visitId !== null && seedTargets.length > 0) {
    const settings = mutableSettingsFor(visitId);
    if (settings && settings.targetIds.length === 0) settings.targetIds = [...seedTargets];
  }
  persistPlan();
}

// A visit the player has not touched has no entry, and reading one must not create it: this is
// called from `activeVisitSettings` and from `waitTimeSecondsFor`, both read inside computeds, and
// a write into `loadedPlan` there would mutate a dependency mid-evaluation. One shared frozen
// default stands in, so a read is a read and its identity is stable across evaluations.
const DEFAULT_VISIT_SETTINGS: VisitSettings = Object.freeze({
  ...newVisitSettings(),
  targetIds: Object.freeze([]) as readonly string[] as string[],
});

export function settingsFor(visitId: string): VisitSettings {
  return loadedPlan.value?.settings[visitId] ?? DEFAULT_VISIT_SETTINGS;
}

/** The writable entry, created on demand. Only the setters below reach for it, and each persists. */
function mutableSettingsFor(visitId: string): VisitSettings | null {
  const plan = loadedPlan.value;
  if (!plan) return null;
  return (plan.settings[visitId] ??= newVisitSettings());
}

export const activeVisitSettings = computed<VisitSettings | null>(() => {
  const visit = activePlanVisit.value;
  if (!visit || !loadedPlan.value) return null;
  return settingsFor(visit.visitId);
});

// Seconds a visit is solved against: what the player typed for it, or what the plan already
// spends on Humility there.
export function waitTimeSecondsFor(visit: HumilityVisit): number {
  const override = settingsFor(visit.visitId).waitTimeOverride;
  return override === null ? visit.plannedDurationSeconds : parseDurationDays(override);
}

export function waitTimeInputFor(visit: HumilityVisit): string {
  const settings = settingsFor(visit.visitId);
  return settings.waitTimeOverride ?? formatDurationInput(visit.plannedDurationSeconds);
}

// Every per-visit input goes through here, and every one of them retracts the recorded answer:
// it was an answer to the question these inputs pose, and nothing else would ever withdraw it.
function editVisit(visitId: string, edit: (settings: VisitSettings) => void): void {
  const plan = loadedPlan.value;
  const settings = mutableSettingsFor(visitId);
  if (!plan || !settings) return;
  edit(settings);
  delete plan.solved[visitId];
  persistPlan();
}

export function setVisitTargets(visitId: string, targetIds: readonly string[]): void {
  editVisit(visitId, s => {
    s.targetIds = [...targetIds];
  });
}

export function setVisitWaitTime(visitId: string, value: string): void {
  editVisit(visitId, s => {
    s.waitTimeOverride = value;
  });
}

export function setVisitFuelBudget(visitId: string, budget: VisitFuelBudget): void {
  editVisit(visitId, s => {
    s.fuelBudget = budget;
  });
}

export function recordSolvedVisit(visit: HumilityPlanVisit): void {
  const plan = loadedPlan.value;
  if (!plan) return;
  plan.solved[visit.visitId] = visit;
  persistPlan();
}

export function clearSolvedVisit(visitId: string): void {
  const plan = loadedPlan.value;
  if (!plan || !(visitId in plan.solved)) return;
  delete plan.solved[visitId];
  persistPlan();
}

export const solvedVisitCount = computed<number>(() => Object.keys(loadedPlan.value?.solved ?? {}).length);

// `parseDurationDays` takes whole-unit tokens, so this rounds to the minute. Only ever seeds an
// input the player can then edit, and a visit budgeted to the second was never meaningful.
function formatDurationInput(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  return formatDuration(Math.round(seconds / 60) * 60, true);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

// `fuelByEgg` is a Map, so the blob carries it as a plain record keyed by the egg's enum value
// and rebuilds it on the way back in.
interface PersistedVisit extends Omit<HumilityVisit, 'fuelByEgg'> {
  fuelByEgg: Record<string, number>;
}

interface PersistedPlan {
  version: number;
  label: string;
  loadedAt: number;
  currentVisitId: string | null;
  visits: PersistedVisit[];
  settings: Record<string, VisitSettings>;
  solved: Record<string, HumilityPlanVisit>;
}

function persistPlan(): void {
  const plan = loadedPlan.value;
  if (!plan) {
    setLocalStorage(PLAN_LOCALSTORAGE_KEY, '');
    return;
  }
  const blob: PersistedPlan = {
    version: PLAN_STORE_VERSION,
    label: plan.label,
    loadedAt: plan.loadedAt,
    currentVisitId: plan.currentVisitId,
    visits: plan.visits.map(v => ({ ...v, fuelByEgg: Object.fromEntries(v.fuelByEgg) })),
    settings: plan.settings,
    solved: plan.solved,
  };
  setLocalStorage(PLAN_LOCALSTORAGE_KEY, JSON.stringify(blob));
}

// Settings written before a field existed come back without it. Filled from the defaults rather
// than answered with a version bump, which would discard a plan mid-cycle over an additive change.
function normalizeSettings(stored: Record<string, VisitSettings> | undefined): Record<string, VisitSettings> {
  const settings: Record<string, VisitSettings> = {};
  for (const [visitId, value] of Object.entries(stored ?? {})) {
    settings[visitId] = { ...newVisitSettings(), ...value };
  }
  return settings;
}

function loadPlan(): LoadedPlan | null {
  const str = getLocalStorage(PLAN_LOCALSTORAGE_KEY);
  if (!str) return null;
  try {
    const parsed = JSON.parse(str) as PersistedPlan;
    if (!parsed || parsed.version !== PLAN_STORE_VERSION || !Array.isArray(parsed.visits)) return null;
    return {
      label: typeof parsed.label === 'string' ? parsed.label : 'Plan',
      loadedAt: typeof parsed.loadedAt === 'number' ? parsed.loadedAt : 0,
      currentVisitId: typeof parsed.currentVisitId === 'string' ? parsed.currentVisitId : null,
      visits: parsed.visits.map(v => ({
        ...v,
        fuelByEgg: new Map(Object.entries(v.fuelByEgg ?? {}).map(([egg, amount]) => [Number(egg) as ei.Egg, amount])),
      })),
      settings: normalizeSettings(parsed.settings),
      solved: parsed.solved ?? {},
    };
  } catch (err) {
    console.warn(`error parsing stored plan: ${err}`);
    return null;
  }
}
