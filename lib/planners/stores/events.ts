import { defineStore } from 'pinia';

export interface GameEvent {
  id: string;
  type: string;
  multiplier: number;
  message: string;
  startTimestamp: number;
  endTimestamp: number;
  ultra: boolean;
}

export interface EventsState {
  allEvents: GameEvent[];
  loading: boolean;
  error: string | null;
  lastFetched: number;
}

export const useEventsStore = defineStore('events', {
  state: (): EventsState => ({
    allEvents: [],
    loading: false,
    error: null,
    lastFetched: 0,
  }),
  actions: {
    async fetchEvents() {
      // Cache for 1 hour to avoid excessive requests
      if (this.allEvents.length > 0 && Date.now() - this.lastFetched < 3600000) {
        return;
      }

      this.loading = true;
      try {
        const response = await fetch(
          'https://raw.githubusercontent.com/carpetsage/egg/refs/heads/main/periodicals/data/events.json'
        );
        if (!response.ok) throw new Error('Failed to fetch events');
        const data = await response.json();
        this.allEvents = data;
        this.lastFetched = Date.now();
      } catch (e) {
        this.error = e instanceof Error ? e.message : 'Unknown error fetching events';
        console.error('Error fetching events:', e);
      } finally {
        this.loading = false;
      }
    },

    getActiveEvents(isUltra: boolean): GameEvent[] {
      const now = Math.floor(Date.now() / 1000);
      const active: GameEvent[] = [];

      // Any event starting more than 7 days ago is assumed to be finished (optimization)
      const threshold = now - 7 * 24 * 60 * 60;

      // Search in reverse order as they are chronological
      for (let i = this.allEvents.length - 1; i >= 0; i--) {
        const event = this.allEvents[i];

        // Optimization: stop if we are past the 1-week window
        if (event.startTimestamp < threshold) {
          break;
        }

        if (event.startTimestamp <= now && event.endTimestamp > now) {
          // Filter by ultra status if not an ultra player
          if (event.ultra && !isUltra) {
            continue;
          }
          active.push(event);
        }
      }

      return active;
    },
  },
});
