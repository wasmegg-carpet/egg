/**
 * A share link the page was opened with (`#share=<id>.<key>`), previewed once per page and shared by whoever
 * handles it: the Plan Library imports plans, the Chain Finder imports tables, and the app switches to the right
 * tab. Previewing never uses up a one-time link; claiming does.
 */
import { reactive } from 'vue';
import { CloudApi } from '../../cloud/api';
import { parseShareLink, previewShare, type ShareInfo } from '../../cloud/share';

const state = reactive({
  /** The link, while one is waiting to be handled. */
  link: '',
  /** What it holds; null when it's gone (expired, revoked, used) or couldn't be read. */
  info: null as ShareInfo | null,
  checked: false,
  error: '',
});

let checking: Promise<void> | null = null;

function check(api: CloudApi): Promise<void> {
  if (checking) return checking;
  checking = (async () => {
    if (typeof location === 'undefined' || !parseShareLink(location.hash)) {
      state.checked = true;
      return;
    }
    state.link = location.href;
    try {
      state.info = await previewShare(api, state.link);
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    }
    state.checked = true;
  })();
  return checking;
}

/** Done with the link (imported or dismissed): drop it from the address bar. */
function clear(): void {
  state.link = '';
  state.info = null;
  state.error = '';
  if (typeof history !== 'undefined' && typeof location !== 'undefined')
    history.replaceState(null, '', `${location.pathname}${location.search}`);
}

export function useIncomingShare(api: CloudApi = new CloudApi()) {
  void check(api);
  return { state, clear };
}
