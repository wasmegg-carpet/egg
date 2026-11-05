/**
 * Store for managing virtue state (current egg, shift count, TE, and ascension timing).
 */

import { defineStore } from 'pinia';
import type { VirtueEgg } from '@/types';
import { getLocalTimestampInTimezone } from '@/lib/events';

/**
 * Get the user's detected timezone.
 */
function getDetectedTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

/**
 * Get current date in YYYY-MM-DD format.
 */
function getCurrentDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get current time in HH:MM format.
 */
function getCurrentTime(): string {
  const now = new Date();
  return now.toTimeString().slice(0, 5);
}

export interface VirtueState {
  // The current virtue egg
  currentEgg: VirtueEgg;

  // Number of shifts performed during this ascension plan
  // Starts at initialShiftCount from player backup
  shiftCount: number;

  // The initial shift count from player backup (before any planned shifts)
  initialShiftCount: number;

  // Eggs of Truth (TE) - affects IHR and earnings bonus multiplier (1.1^TE)
  // This is the sum of virtue.eovEarned from player backup
  te: number;

  // The initial TE from player backup (before any planning)
  initialTE: number;

  // Ascension start time
  ascensionDate: string; // YYYY-MM-DD format
  ascensionTime: string; // HH:MM format
  ascensionTimezone: string; // IANA timezone identifier
  bankValue: number; // Current gems in bank
  population: number; // Current chickens on farm
}

export const useVirtueStore = defineStore('virtue', {
  state: (): VirtueState => ({
    currentEgg: 'curiosity',
    shiftCount: 0,
    initialShiftCount: 0,
    te: 0,
    initialTE: 0,
    ascensionDate: getCurrentDate(),
    ascensionTime: getCurrentTime(),
    ascensionTimezone: getDetectedTimezone(),
    bankValue: 0,
    population: 1,
  }),

  getters: {
    /**
     * Get the planned shift count (shifts added during planning)
     */
    plannedShifts(): number {
      return this.shiftCount - this.initialShiftCount;
    },

    /**
     * Get the base start time for the planning session as a Date object.
     */
    planStartTime(): Date {
      try {
        const ts = getLocalTimestampInTimezone(this.ascensionDate, this.ascensionTime, this.ascensionTimezone);
        return new Date(ts * 1000);
      } catch {
        return new Date();
      }
    },
  },

  actions: {
    /**
     * Set the initial state from player backup.
     */
    setInitialState(initialShiftCount: number, initialTE: number) {
      this.initialShiftCount = initialShiftCount;
      this.shiftCount = initialShiftCount;
      this.initialTE = initialTE;
      this.te = initialTE;
    },

    /**
     * Set the current egg (used when starting ascension or shifting).
     */
    setCurrentEgg(egg: VirtueEgg) {
      this.currentEgg = egg;
    },

    /**
     * Set the shift count directly (used when restoring from snapshot).
     */
    setShiftCount(count: number) {
      this.shiftCount = count;
    },

    /**
     * Perform a shift to a new egg.
     * Increments shift count and changes current egg.
     */
    shift(toEgg: VirtueEgg) {
      if (toEgg !== this.currentEgg) {
        this.currentEgg = toEgg;
        this.shiftCount++;
      }
    },

    /**
     * Set TE (Eggs of Truth) value (0-490)
     */
    setTE(value: number) {
      this.te = Math.max(0, Math.min(490, Math.round(value)));
    },

    /**
     * Set the initial TE value explicitly (baseline for plan).
     */
    setInitialTE(value: number) {
      const newValue = Math.max(0, Math.min(490, Math.round(value)));
      this.initialTE = newValue;
    },

    /**
     * Set the initial shift count (editable by user)
     */
    setInitialShiftCount(value: number) {
      const newValue = Math.max(0, Math.round(value));
      // Update both initial and current if current matches initial
      if (this.shiftCount === this.initialShiftCount) {
        this.shiftCount = newValue;
      }
      this.initialShiftCount = newValue;
    },

    /**
     * Set ascension start date (YYYY-MM-DD format)
     */
    setAscensionDate(date: string) {
      this.ascensionDate = date;
    },

    /**
     * Set ascension start time (HH:MM format)
     */
    setAscensionTime(time: string) {
      this.ascensionTime = time;
    },

    /**
     * Set ascension timezone (IANA timezone identifier)
     */
    setAscensionTimezone(timezone: string) {
      this.ascensionTimezone = timezone;
    },

    /**
     * Set the current bank value.
     */
    setBankValue(value: number) {
      this.bankValue = value;
    },

    /**
     * Set the current population.
     */
    setPopulation(value: number) {
      this.population = value;
    },

    /**
     * Set ascension start from a Unix timestamp (seconds).
     */
    setAscensionStartFromTimestamp(timestampSeconds: number) {
      if (!timestampSeconds) return;
      const date = new Date(timestampSeconds * 1000);

      // Use local time for the input fields
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');

      this.ascensionDate = `${year}-${month}-${day}`;
      this.ascensionTime = `${hours}:${minutes}`;
    },

    /**
     * Reset ascension timing to the user's current local date, time, and timezone.
     */
    resetToCurrentDateTime() {
      this.ascensionDate = getCurrentDate();
      this.ascensionTime = getCurrentTime();
      this.ascensionTimezone = getDetectedTimezone();
    },

    /**
     * Reset to initial state.
     */
    reset() {
      this.shiftCount = this.initialShiftCount;
      this.currentEgg = 'curiosity';
      this.te = this.initialTE;
      this.population = 1;
    },
  },
});
