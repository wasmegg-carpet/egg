<template>
  <input
    v-model="date"
    type="date"
    class="input-premium w-full md:w-auto text-sm font-mono-premium font-bold text-slate-900 py-2.5 px-4"
  />
  <input
    v-model="time"
    type="time"
    class="input-premium w-full md:w-auto text-sm font-mono-premium font-bold text-slate-900 py-2.5 px-4"
  />
  <select
    v-model="timezone"
    class="input-premium w-full md:w-auto text-sm font-mono-premium font-bold text-slate-900 py-2.5 pl-4 pr-12"
  >
    <option v-for="tz in allTimezones" :key="tz.value" :value="tz.value">
      {{ tz.label }}
    </option>
  </select>
</template>

<script setup lang="ts">
/**
 * A date (YYYY-MM-DD), a time (HH:MM) and an IANA time zone, as three inputs with no wrapper, so they
 * sit in the parent's own flex row (Initial State's Ascension Start, Chain Finder's By a date).
 */
import { computed } from 'vue';

const date = defineModel<string>('date', { required: true });
const time = defineModel<string>('time', { required: true });
const timezone = defineModel<string>('timezone', { required: true });

// Get all available timezones grouped by region
const allTimezones = computed(() => {
  try {
    const zones = Intl.supportedValuesOf('timeZone');
    return zones
      .map(tz => {
        // Format: "America/New_York" -> "New York (America)"
        const parts = tz.split('/');
        const city = parts[parts.length - 1].replace(/_/g, ' ');
        const region = parts.length > 1 ? parts[0] : '';
        return {
          value: tz,
          label: region ? `${city} (${region})` : city,
          region,
          city,
        };
      })
      .sort((a, b) => {
        // Sort by region first, then by city
        if (a.region !== b.region) return a.region.localeCompare(b.region);
        return a.city.localeCompare(b.city);
      });
  } catch {
    // Fallback for older browsers
    return [
      { value: 'America/Los_Angeles', label: 'Los Angeles (America)', region: 'America', city: 'Los Angeles' },
      { value: 'America/Denver', label: 'Denver (America)', region: 'America', city: 'Denver' },
      { value: 'America/Chicago', label: 'Chicago (America)', region: 'America', city: 'Chicago' },
      { value: 'America/New_York', label: 'New York (America)', region: 'America', city: 'New York' },
      { value: 'Europe/London', label: 'London (Europe)', region: 'Europe', city: 'London' },
      { value: 'Europe/Paris', label: 'Paris (Europe)', region: 'Europe', city: 'Paris' },
      { value: 'Asia/Tokyo', label: 'Tokyo (Asia)', region: 'Asia', city: 'Tokyo' },
      { value: 'Australia/Sydney', label: 'Sydney (Australia)', region: 'Australia', city: 'Sydney' },
      { value: 'UTC', label: 'UTC', region: '', city: 'UTC' },
    ];
  }
});
</script>
