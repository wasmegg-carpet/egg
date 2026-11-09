/**
 * Store for managing plan timing and the bank (the start time is still called 'ascension' internally).
 */

import { defineStore } from 'pinia';
import { getLocalTimestampInTimezone } from 'lib/planners/events';

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

export interface PlanState {
  // Ascension start time
  ascensionDate: string; // YYYY-MM-DD format
  ascensionTime: string; // HH:MM format
  ascensionTimezone: string; // IANA timezone identifier
  bankValue: number; // Current bocks in bank
  population: number; // Current chickens on farm
}

export const usePlanStore = defineStore('virtue', {
  state: (): PlanState => ({
    ascensionDate: getCurrentDate(),
    ascensionTime: getCurrentTime(),
    ascensionTimezone: getDetectedTimezone(),
    bankValue: 0,
    population: 1,
  }),

  getters: {
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
      this.population = 1;
    },
  },
});
