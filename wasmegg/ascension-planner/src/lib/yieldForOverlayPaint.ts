/**
 * Yields to the browser so a pending DOM update (e.g. a loading overlay) can actually paint before
 * a long synchronous computation continues — but only when there's someone who could be watching.
 *
 * A plain `setTimeout(resolve, 0)` is NOT safe for this: once a tab is backgrounded, browsers
 * throttle timer callbacks heavily (on some mobile browsers, for minutes or longer) to save
 * battery. Awaiting one unconditionally means: if the tab gets backgrounded in the gap between
 * setting a loading flag and the timer firing, the overlay shows but the work behind it never
 * continues until the timer is eventually allowed to fire — which, if the tab stays backgrounded,
 * can look exactly like the page is stuck forever. (This is invisible in normal foreground testing
 * — foreground tabs aren't throttled, so the yield resolves on the next tick as expected.)
 *
 * Fix: if the tab is already hidden, skip waiting entirely (nothing to paint for, so just continue
 * immediately rather than risk waiting on a throttled timer); if it becomes hidden while waiting,
 * stop waiting and proceed right away instead of staying blocked on the timer.
 */
export function yieldForOverlayPaint(): Promise<void> {
  if (typeof document === 'undefined' || document.hidden) return Promise.resolve();

  return new Promise<void>(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      resolve();
    };
    const onVisibilityChange = () => {
      if (document.hidden) finish();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    setTimeout(finish, 0);
  });
}
