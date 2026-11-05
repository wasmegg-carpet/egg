# Ascension Planner - Component Architecture Design

## Overview

This application has many interdependent calculations where the output of one component becomes the input to another. This document describes the architecture for managing this reactive data flow.

## Core Principles

1. **Unidirectional Data Flow** - Data flows down through props, events flow up through emits
2. **Single Source of Truth** - Each piece of state lives in exactly one place
3. **Computed Derivations** - Derived values are computed reactively, never stored redundantly
4. **Explicit Dependencies** - Every calculation explicitly declares its inputs
5. **Composable Logic** - Calculation logic lives in composables, separate from UI
6. **No Logic in Components** - All JavaScript logic (especially math/calculations) lives in separate `.ts` files

---

## No Logic in Components (Critical Rule)

**Vue components (`.vue` files) contain ONLY:**

- Template markup (HTML)
- Props and emits definitions
- Imports from `.ts` files
- Simple computed properties that combine imported functions

**All logic lives in `.ts` files:**

- `calculations/*.ts` - Pure math/business logic functions
- `lib/*.ts` - Utility functions (formatting, parsing, helpers)
- `composables/*.ts` - Reactive wrappers around calculations
- `stores/*.ts` - State management

### Why?

1. **Testability** - Pure `.ts` functions can be unit tested without Vue
2. **Reusability** - Logic can be shared across components
3. **Clarity** - Components focus on presentation, logic is centralized
4. **Debugging** - Easier to trace calculations through dedicated files

### Example: Correct vs Incorrect

```vue
<!-- INCORRECT: Logic in component -->
<script setup lang="ts">
const calculateBonus = (level: number) => 1 + level * 0.05;  // BAD!
const formattedValue = computed(() => {
  const bonus = calculateBonus(level.value);  // BAD!
  return bonus.toFixed(2) + 'x';
});
</script>
```

```vue
<!-- CORRECT: Logic imported from .ts files -->
<script setup lang="ts">
import { calculateBonus } from '@/calculations/bonuses';
import { formatMultiplier } from '@/lib/format';

const formattedValue = computed(() => formatMultiplier(calculateBonus(level.value)));
</script>
```

### File Responsibilities

| File Type | Contains | Does NOT Contain |
| --------- | -------- | ---------------- |
| `*.vue` | Template, props, emits, imports | Math, string formatting, business logic |
| `calculations/*.ts` | Pure calculation functions | Vue reactivity, DOM access |
| `lib/*.ts` | Formatting, parsing, utilities | Vue reactivity, state |
| `composables/*.ts` | Reactive wrappers (`computed`) | Business logic (delegates to calculations) |
| `stores/*.ts` | State, actions | Complex calculations (delegates to calculations) |

---

## State Management Architecture

### Three Tiers of State

```
┌─────────────────────────────────────────────────────────────┐
│                     GLOBAL STATE (Pinia)                    │
│  Player data, epic research, artifacts, target goals        │
│  Rarely changes during a session                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    PLAN STATE (Pinia)                       │
│  Step list, step order, which steps are expanded            │
│  Changes when user adds/removes/reorders steps              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   STEP STATE (Per-step ref)                 │
│  Research log, vehicle log, hab log for this step           │
│  Changes frequently as user makes purchases                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 DERIVED STATE (Computed)                    │
│  Metrics, durations, timelines - NEVER stored               │
│  Recalculated automatically when dependencies change        │
└─────────────────────────────────────────────────────────────┘
```

---

## Store Definitions

### 1. Player Store (`stores/player.ts`)

Global player state that doesn't change during planning.

```typescript
// stores/player.ts
import { defineStore } from 'pinia';

export interface PlayerState {
  // Immutable during session (from backup)
  soulEggs: number;
  truthEggs: number;
  clothedTruthEggs: number;

  // Epic research levels
  epicResearch: {
    labUpgrade: number;          // -5% research cost per level
    cheaperContractors: number;  // -5% hab cost per level
    bustUnions: number;          // -5% vehicle cost per level
    transportationLobbyist: number;
    siloCapacity: number;
    // ... etc
  };

  // Colleggtible modifiers (multiplicative)
  modifiers: {
    earnings: number;
    researchCost: number;
    habCost: number;
    vehicleCost: number;
    // ... etc
  };

  // Current virtue egg progress
  virtueEggsLaid: Record<VirtueEgg, number>;

  // User-configurable goals
  targetGains: Record<VirtueEgg, number>;
  startTime: number;
}

export const usePlayerStore = defineStore('player', {
  state: (): PlayerState => ({ /* defaults */ }),

  getters: {
    // Derived values that depend only on player state
    researchCostMultiplier: (state) => {
      const epicDiscount = 1 - (state.epicResearch.labUpgrade * 0.05);
      const colleggtibleMod = state.modifiers.researchCost;
      return epicDiscount * colleggtibleMod;
    },

    habCostMultiplier: (state) => { /* similar */ },
    vehicleCostMultiplier: (state) => { /* similar */ },
  },

  actions: {
    loadFromBackup(backup: PlayerBackup) { /* populate state */ },
    setTargetGains(gains: Record<VirtueEgg, number>) { /* update */ },
  },
});
```

### 2. Plan Store (`stores/plan.ts`)

The list of steps and their configuration.

```typescript
// stores/plan.ts
import { defineStore } from 'pinia';

export interface Step {
  id: string;
  eggType: VirtueEgg;
  visitNumber: number;  // Computed, not stored
  expanded: boolean;

  // Purchase logs - the SOURCE OF TRUTH for what was bought
  researchLog: ResearchLogEntry[];
  vehicleLog: VehicleLogEntry[];
  habUpgradeLog: HabUpgradeLogEntry[];

  // Humility-specific
  scheduledLaunches?: ScheduledLaunch[];
}

export const usePlanStore = defineStore('plan', {
  state: () => ({
    steps: [] as Step[],
  }),

  getters: {
    // Visit numbers are DERIVED from step order
    stepsWithVisitNumbers: (state) => {
      const counts: Record<VirtueEgg, number> = { /* zeros */ };
      return state.steps.map(step => ({
        ...step,
        visitNumber: ++counts[step.eggType],
      }));
    },

    // Which steps are "final" (last visit to each egg with a target)
    finalVisitFlags: (state) => {
      // Returns Map<stepId, boolean>
    },
  },

  actions: {
    addStep(eggType: VirtueEgg) { /* ... */ },
    removeStep(id: string) { /* ... */ },
    reorderSteps(fromIndex: number, toIndex: number) { /* ... */ },

    // Step mutations
    addResearch(stepId: string, entry: ResearchLogEntry) { /* ... */ },
    addVehicle(stepId: string, entry: VehicleLogEntry) { /* ... */ },
    addHabUpgrade(stepId: string, entry: HabUpgradeLogEntry) { /* ... */ },
  },
});
```

---

## Composables for Calculations

Calculations live in composables, NOT in components or stores. This keeps them:
- Testable (pure functions with explicit inputs)
- Reusable (same logic, different contexts)
- Cacheable (Vue's computed handles memoization)

### Pattern: Calculation Composable

```typescript
// composables/useStepMetrics.ts

export interface StepMetricsInput {
  step: Step;
  previousSteps: Step[];
  playerState: PlayerState;
}

export interface StepMetrics {
  elr: number;
  offlineIHR: number;
  habCapacity: number;
  shippingCapacity: number;
  offlineEarningsProjected: number;
  timeToFillHabs: number;
}

export function useStepMetrics(input: ComputedRef<StepMetricsInput>): ComputedRef<StepMetrics> {
  return computed(() => {
    const { step, previousSteps, playerState } = input.value;
    return calculateStepMetrics(step, previousSteps, playerState);
  });
}

// Pure function - no Vue reactivity, fully testable
export function calculateStepMetrics(
  step: Step,
  previousSteps: Step[],
  playerState: PlayerState
): StepMetrics {
  // All calculation logic here
  // Returns a plain object
}
```

### Composable Dependency Chain

```
┌──────────────────┐
│  usePlayerStore  │ (global)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐     ┌──────────────────┐
│  useResearchLog  │────▶│  useStepMetrics  │
└──────────────────┘     └────────┬─────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         │                        │                        │
         ▼                        ▼                        ▼
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ usePurchaseTimes │     │  useStepDuration │     │ useTimelineEntry │
└──────────────────┘     └────────┬─────────┘     └──────────────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │   useTimeline    │
                         └──────────────────┘
```

---

## Component Structure

### Pattern: Smart Container + Dumb Presenter

```
┌─────────────────────────────────────────────┐
│           StepContainer.vue                 │
│  - Connects to stores                       │
│  - Calls composables with store data        │
│  - Passes computed results as props         │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│           StepPresenter.vue                 │
│  - Receives all data as props               │
│  - Emits events for user actions            │
│  - No direct store access                   │
│  - Pure rendering logic                     │
└─────────────────────────────────────────────┘
```

### Example: Step Component

```vue
<!-- components/StepContainer.vue -->
<template>
  <step-presenter
    :step="step"
    :metrics="metrics"
    :purchase-times="purchaseTimes"
    :arrival-time="arrivalTime"
    :departure-time="departureTime"
    @add-research="handleAddResearch"
    @add-vehicle="handleAddVehicle"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { usePlayerStore } from '@/stores/player';
import { usePlanStore } from '@/stores/plan';
import { useStepMetrics } from '@/composables/useStepMetrics';
import { usePurchaseTimes } from '@/composables/usePurchaseTimes';

const props = defineProps<{
  stepId: string;
  stepIndex: number;
}>();

const playerStore = usePlayerStore();
const planStore = usePlanStore();

// Get this step and previous steps from store
const step = computed(() => planStore.steps[props.stepIndex]);
const previousSteps = computed(() => planStore.steps.slice(0, props.stepIndex));

// Calculate metrics using composable
const metricsInput = computed(() => ({
  step: step.value,
  previousSteps: previousSteps.value,
  playerState: playerStore.$state,
}));
const metrics = useStepMetrics(metricsInput);

// Calculate purchase times using composable (depends on metrics)
const purchaseTimesInput = computed(() => ({
  step: step.value,
  previousSteps: previousSteps.value,
  playerState: playerStore.$state,
  metrics: metrics.value,
}));
const purchaseTimes = usePurchaseTimes(purchaseTimesInput);

// Timeline data (injected from parent or computed here)
const arrivalTime = computed(() => /* from timeline composable */);
const departureTime = computed(() => /* from timeline composable */);

// Event handlers mutate the store
function handleAddResearch(entry: ResearchLogEntry) {
  planStore.addResearch(props.stepId, entry);
}
</script>
```

```vue
<!-- components/StepPresenter.vue -->
<template>
  <div class="step">
    <step-header :metrics="metrics" :arrival="arrivalTime" :departure="departureTime" />

    <research-section
      :researches="step.researchLog"
      :purchase-times="purchaseTimes"
      @add="$emit('add-research', $event)"
    />

    <!-- etc -->
  </div>
</template>

<script setup lang="ts">
// Only props and emits - no store access
defineProps<{
  step: Step;
  metrics: StepMetrics;
  purchaseTimes: PurchaseTime[];
  arrivalTime: number;
  departureTime: number;
}>();

defineEmits<{
  'add-research': [entry: ResearchLogEntry];
  'add-vehicle': [entry: VehicleLogEntry];
}>();
</script>
```

---

## Calculation Inputs and Outputs

### Explicit Interface Pattern

Every calculation function/composable has explicit input and output types:

```typescript
// types/calculations.ts

/**
 * Inputs required to calculate step metrics.
 * Document what each input is used for.
 */
export interface StepMetricsInput {
  /** Current step's purchase logs */
  step: Step;

  /** All steps before this one (for cumulative research, etc.) */
  previousSteps: Step[];

  /** Player's base stats and modifiers */
  playerState: PlayerState;
}

/**
 * Output metrics for a step.
 * These become inputs to other calculations.
 */
export interface StepMetrics {
  /** Eggs laid per second at max population */
  elr: number;

  /** Internal hatchery rate (chickens/min) while offline */
  offlineIHR: number;

  /** Maximum chicken population (hab capacity) */
  habCapacity: number;

  /** Maximum eggs/sec that can be shipped */
  shippingCapacity: number;

  /** Earnings per second at max population */
  offlineEarningsProjected: number;

  /** Seconds to fill habs from empty */
  timeToFillHabs: number;
}
```

### Dependency Documentation

Each composable documents its dependencies:

```typescript
/**
 * Calculate duration for a step.
 *
 * Dependencies:
 * - StepMetrics (from useStepMetrics)
 * - PlayerState.targetGains (for final visit calculations)
 * - Step.isFinalVisit flag
 *
 * Used by:
 * - useTimeline (to compute arrival/departure times)
 * - CompletionSummary (to show total duration)
 */
export function useStepDuration(input: ComputedRef<StepDurationInput>): ComputedRef<number> {
  // ...
}
```

---

## Data Flow Example

Here's how data flows when a user buys a research item:

```
1. User clicks "Buy Research" button
   │
   ▼
2. StepPresenter emits 'add-research' event
   │
   ▼
3. StepContainer handles event, calls planStore.addResearch()
   │
   ▼
4. Plan store updates step.researchLog (SOURCE OF TRUTH mutates)
   │
   ▼
5. Vue reactivity triggers recomputation:
   │
   ├──▶ metricsInput computed updates (depends on step)
   │    │
   │    ▼
   │    useStepMetrics recomputes (new earnings rate, etc.)
   │    │
   │    ▼
   │    purchaseTimesInput computed updates (depends on metrics)
   │    │
   │    ▼
   │    usePurchaseTimes recomputes (new time-to-earn values)
   │
   ├──▶ useStepDuration recomputes (depends on metrics)
   │    │
   │    ▼
   │    useTimeline recomputes (new arrival/departure times)
   │
   └──▶ UI re-renders with new values
```

---

## File Organization

```
src/
├── stores/
│   ├── player.ts        # Global player state
│   └── plan.ts          # Step list and mutations
│
├── composables/
│   ├── useStepMetrics.ts      # ELR, IHR, hab cap, earnings
│   ├── usePurchaseTimes.ts    # Time to earn each purchase
│   ├── useStepDuration.ts     # Total step duration
│   ├── useTimeline.ts         # Arrival/departure for all steps
│   └── index.ts               # Re-exports
│
├── calculations/
│   ├── metrics.ts       # Pure functions for metrics
│   ├── duration.ts      # Pure functions for duration
│   ├── timeline.ts      # Pure functions for timeline
│   └── index.ts         # Re-exports
│
├── components/
│   ├── containers/      # Smart components (store access)
│   │   ├── StepContainer.vue
│   │   └── PlanContainer.vue
│   │
│   ├── presenters/      # Dumb components (props only)
│   │   ├── StepHeader.vue
│   │   ├── ResearchSection.vue
│   │   └── VehicleSection.vue
│   │
│   └── shared/          # Reusable UI components
│       ├── MetricDisplay.vue
│       └── DurationDisplay.vue
│
├── types/
│   ├── player.ts        # Player-related types
│   ├── plan.ts          # Plan and step types
│   ├── calculations.ts  # Input/output types for calculations
│   └── index.ts         # Re-exports
│
└── lib/
    ├── catalog.json     # Reference data
    └── researches.json  # Reference data
```

---

## Testing Strategy

### Unit Tests for Pure Calculations

```typescript
// calculations/metrics.test.ts
import { calculateStepMetrics } from './metrics';

describe('calculateStepMetrics', () => {
  it('calculates ELR correctly with no research', () => {
    const result = calculateStepMetrics(
      emptyStep,
      [],
      defaultPlayerState
    );
    expect(result.elr).toBe(/* expected value */);
  });

  it('increases earnings after buying research', () => {
    const before = calculateStepMetrics(emptyStep, [], playerState);
    const after = calculateStepMetrics(stepWithResearch, [], playerState);
    expect(after.offlineEarningsProjected).toBeGreaterThan(before.offlineEarningsProjected);
  });
});
```

### Integration Tests for Composables

```typescript
// composables/useStepMetrics.test.ts
import { useStepMetrics } from './useStepMetrics';

describe('useStepMetrics', () => {
  it('recomputes when step changes', async () => {
    const step = ref(emptyStep);
    const input = computed(() => ({ step: step.value, /* ... */ }));
    const metrics = useStepMetrics(input);

    const earningsBefore = metrics.value.offlineEarningsProjected;

    step.value = { ...step.value, researchLog: [someResearch] };
    await nextTick();

    expect(metrics.value.offlineEarningsProjected).toBeGreaterThan(earningsBefore);
  });
});
```

---

## Summary

| Concern | Location | Reactivity |
|---------|----------|------------|
| Player data | `stores/player.ts` | Pinia state |
| Step list | `stores/plan.ts` | Pinia state |
| Purchase logs | `step.researchLog`, etc. | Part of step state |
| Metrics | `composables/useStepMetrics` | Computed |
| Durations | `composables/useStepDuration` | Computed |
| Timeline | `composables/useTimeline` | Computed |
| UI rendering | `components/presenters/` | Props |
| Store mutations | `components/containers/` | Event handlers |

**Key Rules:**
1. State lives in stores (Pinia)
2. Derived values are computed (never stored)
3. Calculations live in composables (testable, reusable)
4. Presenters receive props (no store access)
5. Containers connect stores to presenters
6. Every input/output has explicit TypeScript types
