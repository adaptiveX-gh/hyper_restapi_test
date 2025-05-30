/*  js/core/dom.js
    ─────────────────────────────────────────────────────────────
    Minimal DOM utility helpers that work with *either*
    a string element-ID **or** a direct Element reference.
*/

/* ---------- element selectors -------------------------------- */
export const $  = (elOrId) =>
  typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;

export const $$ = (sel) => [...document.querySelectorAll(sel)];

/* ---------- text helpers ------------------------------------- */
export const text = (target, value = '') => {
  const el = $(target);
  if (el) el.textContent = value;
};

export const append = (target, value = '') => {
  const el = $(target);
  if (el) el.textContent += value;
};

/* ---------- textarea helper ---------------------------------- */
/** Read a textarea (or any element with `.value`) into
 *  an array of trimmed, non-empty lines. */
export function readLines (elOrId) {
  const el = $(elOrId);
  if (!el) return [];
  return (el.value || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);
}

/* ---------- clipboard helpers -------------------------------- */
export function copyText (elOrId) {
  const txt = $(elOrId)?.textContent ?? '';
  return navigator.clipboard.writeText(txt);
}

/*  🔒 alias for older modules that still import this name  */
export const copyToClipboard = copyText;

/* ---------- global console → log pane funnel ---------------- */
const logPane = $('logs-global');        // may be null on very early import
const origLog = console.log.bind(console);

console.log = (...args) => {
  origLog(...args);
  if (logPane) {
    append(
      logPane,
      args
        .map((a) =>
          typeof a === 'object' ? JSON.stringify(a) : String(a)
        )
        .join(' ') + '\n'
    );
  }
};

/* clear-logs button (only if it exists now) */
$('logs-clear')?.addEventListener('click', () => text(logPane, ''));
