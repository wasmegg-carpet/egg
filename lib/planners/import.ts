import { defineAsyncComponent, type AsyncComponentLoader } from 'vue';
import { useWarningStore } from './stores/warning';

/**
 * A wrapper for dynamic imports that handles failures caused by stale assets
 * (e.g., when a new version is deployed and old chunks are removed from the server).
 *
 * It retries the import a few times, and if it still fails with a fetch error,
 * it prompts the user to refresh the page.
 */
export async function safeImport<T>(importFn: () => Promise<T>, retries = 2): Promise<T> {
  try {
    return await importFn();
  } catch (error) {
    if (retries > 0) {
      // Wait a bit before retrying
      await new Promise(resolve => setTimeout(resolve, 500));
      return safeImport(importFn, retries - 1);
    }

    const errorString = String(error);
    const isFetchError =
      error instanceof TypeError ||
      errorString.includes('Failed to fetch') ||
      errorString.includes('dynamically imported module') ||
      errorString.includes('Importing a billion times'); // Some browsers have unique messages

    if (isFetchError) {
      console.error('Dynamic import failed (likely stale assets):', error);
      const warningStore = useWarningStore();
      warningStore.showRefreshPrompt();
      
      // Return a promise that never resolves to prevent the UI from
      // continuing with broken state while the dialog is open.
      return new Promise(() => {});
    }

    // If it's some other error, just rethrow it
    throw error;
  }
}

/**
 * A wrapper for defineAsyncComponent that handles failures using safeImport.
 */
export function safeAsyncComponent(loader: AsyncComponentLoader) {
  return defineAsyncComponent(() => safeImport(loader));
}
