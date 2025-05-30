import { $ } from './dom.js';

/**
 * Injects a progress bar wrapper + bar.
 * @param {string|HTMLElement} anchor  where to insert
 * @param {string} barId               id for <div class="progress-bar">
 * @param {'before'|'after'} pos       insert position (default 'after')
 */
export function mountProgressBar(anchor, barId, pos = 'after') {
  if ($(barId)) return;                         // already mounted

  const track = document.createElement('div');
  track.className = 'progress-track';

  const bar = document.createElement('div');
  bar.id = barId;
  bar.className = 'progress-bar';

  track.appendChild(bar);

  const ref = $(anchor);
  if (!ref) return;

  (pos === 'before' ? ref.before(track) : ref.after(track));
}

/* update + reset helpers */
export const setProgress   = (barId, frac) =>
  ($(barId).style.width = `${Math.min(1, Math.max(0, frac)) * 100}%`);

export const resetProgress = (barId) => setProgress(barId, 0);
