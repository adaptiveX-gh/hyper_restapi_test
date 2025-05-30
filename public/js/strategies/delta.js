/*  js/strategies/delta.js
    ─────────────────────────────────────────────────────────────
    Position‑Delta‑Pulse pane – start / stop stream + progress & timer
*/

import { $, append, text, readLines } from '../core/dom.js';
import { loadSheetAddresses }          from '../core/api.js';
import { mountProgressBar, setProgress, resetProgress } from '../core/progress.js';

/* ─────────────────────────────  DOM refs  ───────────────────────────── */
const addrBox  = $('delta-addrs');
const resBox   = $('delta-results');
const statsBox = $('delta-stats');

const btnStart = $('delta-run');          // “Run Stream”
const btnStop  = $('delta-stop');         // “Stop Stream” (may be null if not yet in HTML)

/* where to inject bar + timer */
const BAR_ID   = 'delta-progress';
const TIMER_ID = 'delta-timer';
const ANCHOR   = 'delta-progress-anchor';

/* ─────────────────────────────  Event wiring  ───────────────────────── */
$('delta-load')       ?.addEventListener('click', handleLoadAddrs);
btnStart              ?.addEventListener('click', startDeltaStream);
btnStop               ?.addEventListener('click', stopDeltaStream);
$('delta-clear-results')?.addEventListener('click', () => text(resBox, ''));
$('delta-clear-stats')  ?.addEventListener('click', () => text(statsBox, ''));
$('delta-copy-results') ?.addEventListener('click', () => navigator.clipboard.writeText(resBox.textContent));

/* ─────────────────────────────  helpers  ───────────────────────────── */
const numOrU = id => {
  const v = $(id)?.value?.trim() ?? '';
  return v === '' ? undefined : Number(v);
};
const safeJsonParse = (raw, fb = {}) => { try { return JSON.parse(raw); } catch { return fb; } };

/* ─────────────────────────────  Timer  ─────────────────────────────── */
let timerHandle = null;
function startTimer () {
  let el = $(TIMER_ID);
  if (!el) {
    el = document.createElement('span');
    el.id = TIMER_ID;
    el.style.cssText = 'margin-left:8px;font-family:monospace;font-size:.85rem;opacity:.7';
    $(BAR_ID).after(el);
  }
  const bar = $(BAR_ID);
  (bar?.parentElement ?? bar).after(el);

  const t0 = Date.now();
  const tick = () => {
    const s = Math.floor((Date.now() - t0) / 1000);
    el.textContent = `⏱ ${String((s / 60) | 0).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  };
  tick();
  timerHandle = setInterval(tick, 1000);
}
function stopTimer () { if (timerHandle) clearInterval(timerHandle); timerHandle = null; $(TIMER_ID)?.remove(); }

/* ─────────────────────────────  state  ─────────────────────────────── */
let abortCtrl = null;   // AbortController for running fetch
let reader    = null;   // ReadableStream reader

/* ============================================================ */
/*  1 · LOAD ADDRESSES                                          */
/* ============================================================ */
async function handleLoadAddrs () {
  text(statsBox,'');
  const filters = {
    pnlMin     : numOrU('delta-pnlMin'),
    winRateMin : numOrU('delta-winRateMin'),
    durationMin: numOrU('delta-durationMin')  // hrs
  };
  try {
    const addrs = await loadSheetAddresses(filters);
    addrBox.value = addrs.join('\n');
    text(statsBox, `✅ ${addrs.length} addresses loaded`);
  } catch (err) {
    text(statsBox, `❌ ${err.message}`);
    console.error('[delta] loadSheetAddresses failed', err);
  }
}

/* ============================================================ */
/*  2 · START STREAM                                            */
/* ============================================================ */
async function startDeltaStream () {
  if (abortCtrl) return;   // already running

  btnStart?.setAttribute('disabled', '');
  btnStop ?.removeAttribute('disabled');

  text(resBox,'');
  text(statsBox,'');

  mountProgressBar(ANCHOR, BAR_ID, 'after');
  resetProgress(BAR_ID);
  startTimer();

  const addrs = readLines(addrBox);
  const totalAddr = addrs.length || 1;
  const seenWallets = new Set();          // NEW – track first log per wallet

  const minutes = +$('delta-minutes')?.value || 10;
  const params  = safeJsonParse($('delta-params')?.value);

  abortCtrl = new AbortController();
  const { signal } = abortCtrl;

  let res;
  try {
    res = await fetch('/api/positionDeltaPulseStream', {
      method  : 'POST',
      signal,
      headers : { 'Content-Type':'application/json' },
      body    : JSON.stringify({ addresses:addrs, minutes, params })
    });
  } catch (err) {
    if (err.name !== 'AbortError') text(statsBox, `❌ ${err.message}`);
    cleanup();
    return;
  }
  if (!res.body) { text(statsBox,'❌ no response body'); cleanup(); return; }

  reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream:true });

      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;

        const j = JSON.parse(line);
        if (j.type === 'log')    append(statsBox, line+'\n');
        if (j.type === 'result') append(resBox, line+'\n');

        /* update progress when we encounter the FIRST log for each wallet */
        if (j.type === 'log' && j.wallet && !seenWallets.has(j.wallet)) {
          seenWallets.add(j.wallet);
          setProgress(BAR_ID, seenWallets.size / totalAddr);
        }

        if (j.type === 'summary') {
          if (!resBox.textContent.trim()) text(resBox,'no-setup\n');
          setProgress(BAR_ID, 1);
          cleanup();
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') console.error('[delta] stream error', err);
    cleanup();
  }
}

/* ============================================================ */
/*  3 · STOP STREAM                                             */
/* ============================================================ */
function stopDeltaStream () {
  if (!abortCtrl) return;
  abortCtrl.abort();
  reader?.cancel().catch(()=>{});
  cleanup();
}

/* ─────────────────────────────  cleanup  ───────────────────────────── */
function cleanup () {
  abortCtrl = null;
  reader    = null;
  stopTimer();
  setProgress(BAR_ID, 0);
  btnStart?.removeAttribute('disabled');
  btnStop ?.setAttribute('disabled','');
}
