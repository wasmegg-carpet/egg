/**
 * Scroll an element into view by id and briefly flash it with an amber highlight.
 * Used by the curiosity summary's clickable research links to jump to the corresponding
 * action row in the history list. A no-op if the element isn't currently in the DOM
 * (e.g. its containing day/group is still collapsed — callers should expand that first).
 */
export function scrollToAndHighlight(elementId: string): void {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('bg-amber-100/50');
  setTimeout(() => el.classList.remove('bg-amber-100/50'), 2000);
}
