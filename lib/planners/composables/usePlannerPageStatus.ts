import { computed, watch } from 'vue';
import { PROFILE } from '@planner/lib/profile';
import { useInitialStateStore } from '@planner/stores/initialState';

/** How old the loaded backup is, and the page title that names the player. */
export function usePlannerPageStatus() {
  const initialStateStore = useInitialStateStore();

  const lastBackupFormatted = computed(() => {
    const approxTime = initialStateStore.rawBackup?.approxTime;
    if (approxTime == null) return 'Unknown';
    const date = new Date(approxTime * 1000);

    return date.toLocaleTimeString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  });

  const lastBackupAge = computed(() => {
    const approxTime = initialStateStore.rawBackup?.approxTime;
    if (approxTime == null) return '';
    const now = Date.now() / 1000;
    const diff = Math.max(0, now - approxTime);

    if (diff < 60) return 'Just now';

    const minutes = Math.floor(diff / 60);
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h${remainingMinutes}m ago`;
  });

  const pageTitle = computed(() => {
    const name = initialStateStore.rawBackup?.userName;
    return name ? `${PROFILE.appName} ${name}` : PROFILE.appName;
  });

  watch(
    pageTitle,
    newTitle => {
      document.title = newTitle;
    },
    { immediate: true }
  );

  return { lastBackupFormatted, lastBackupAge, pageTitle };
}
