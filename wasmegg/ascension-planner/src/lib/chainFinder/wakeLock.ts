/**
 * Keeps the screen (and so the computer) awake during a Table Builder build with the Screen Wake
 * Lock API. The browser drops the lock whenever the tab is hidden, so it's re-requested each time
 * the tab becomes visible again. A no-op where the API is missing (or outside a secure context).
 */

/** Holds the lock until the returned function is called; `onChange` reports whether it's held. */
export function holdWakeLock(onChange: (held: boolean) => void): () => void {
  if (!('wakeLock' in navigator)) {
    onChange(false);
    return () => {};
  }
  let sentinel: WakeLockSentinel | null = null;
  let released = false;

  const acquire = async () => {
    if (released || sentinel || document.visibilityState !== 'visible') return;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (released) return void lock.release();
      sentinel = lock;
      onChange(true);
      lock.addEventListener('release', () => {
        if (sentinel === lock) sentinel = null;
        if (!released) onChange(false);
      });
    } catch {
      // Refused (e.g. battery saver); the build runs regardless.
      onChange(false);
    }
  };
  const onVisibility = () => void acquire();

  document.addEventListener('visibilitychange', onVisibility);
  void acquire();

  return () => {
    released = true;
    document.removeEventListener('visibilitychange', onVisibility);
    void sentinel?.release();
    sentinel = null;
    onChange(false);
  };
}
