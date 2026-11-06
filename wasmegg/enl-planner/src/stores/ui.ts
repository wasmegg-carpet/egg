import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useUIStore = defineStore('ui', () => {
  const isHeaderCollapsed = ref(false);
  const isFooterCollapsed = ref(false);
  const loading = ref(false);
  const error = ref('');

  function setHeaderCollapsed(collapsed: boolean) {
    isHeaderCollapsed.value = collapsed;
  }

  function setLoading(l: boolean) {
    loading.value = l;
  }

  function setError(e: string) {
    error.value = e;
  }

  return {
    isHeaderCollapsed,
    isFooterCollapsed,
    loading,
    error,
    setHeaderCollapsed,
    setLoading,
    setError,
  };
});
