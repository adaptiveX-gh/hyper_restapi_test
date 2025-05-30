/*  js/strategies/sentiment.js
    ─────────────────────────────────────────────────────────────
    Market Sentiment pane – start / stop stream + progress & timer
*/

import { $, append, text, readLines } from '../core/dom.js';
import { loadSheetAddresses }          from '../core/api.js';
import { mountProgressBar, setProgress, resetProgress } from '../core/progress.js';

/* ─────────────────────────────  DOM refs  ───────────────────────────── */
const addrBox  = $('sentiment-addrs');
const outBox   = $('sentiment-output');
const statsBox = $('sentiment-stats');

const btnStart = $('sentiment-run');          // “Run Stream” button
const btnStop  = $('sentiment-stop');         // new Stop button (may be null until added)

/* ids for bar + timer */
const BAR_ID   = 'sentiment-progress';
const TIMER_ID = 'sentiment-timer';
const ANCHOR   = 'sentiment-progress-anchor';

/* ─────────────────────────────  Event wiring  ───────────────────────── */
$('sentiment-load')?.addEventListener('click', loadAddresses);
btnStart?.addEventListener('click', startSentimentStream);
btnStop?.addEventListener('click', stopSentimentStream);

$('sentiment-clear-stats')?.addEventListener('click', () => text(statsBox, ''));
$('sentiment-clear-results')?.addEventListener('click', () => text(outBox, ''));
$('sentiment-copy-stats')?.addEventListener('click', () => navigator.clipboard.writeText(statsBox.textContent));
$('sentiment-copy-output')?.addEventListener('click', () => navigator.clipboard.writeText(outBox.textContent));

/* ─────────────────────────────  helpers  ───────────────────────────── */
const numOrU = id => { const v = $(id)?.value?.trim() ?? ''; return v === '' ? undefined : Number(v); };

/* ─────────────────────────────  Timer helpers  ─────────────────────── */
let timerHandle = null;
function startTimer () {
  let el = $(TIMER_ID);
  if (!el) {
    el = document.createElement('span');
    el.id = TIMER_ID;
    el.style.cssText = 'margin-left:8px;font-family:monospace;font-size:.85rem;opacity:.7';
    $(BAR_ID).after(el);
  }
  const bar = $(BAR_ID); (bar?.parentElement ?? bar).after(el);
  const t0 = Date.now();
  const tick = () => {
    const s = ((Date.now() - t0) / 1000)|0;
    el.textContent = `⏱ ${String((s/60)|0).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  };
  tick(); timerHandle = setInterval(tick, 1000);
}
function stopTimer () { if (timerHandle) clearInterval(timerHandle); timerHandle = null; $(TIMER_ID)?.remove(); }

/* ─────────────────────────────  state  ─────────────────────────────── */
let abortCtrl = null; let reader = null;

/* ============================================================ */
/*  1 · LOAD ADDRESSES                                          */
/* ============================================================ */
async function loadAddresses () {
  text(statsBox, '');
  const filters = { pnlMin:numOrU('sentiment-pnlMin'), winRateMin:numOrU('sentiment-winRateMin'), durationMin:numOrU('sentiment-durationMin') };
  try {
    const addrs = await loadSheetAddresses(filters);
    addrBox.value = addrs.join('\n');
    text(statsBox, `✅ ${addrs.length} addresses loaded`);
  } catch (err) {
    text(statsBox, `❌ ${err.message}`);
    console.error('[sentiment] loadSheetAddresses failed', err);
  }
}

/* ============================================================ */
/*  2 · START STREAM                                            */
/* ============================================================ */
async function startSentimentStream () {
  if (abortCtrl) return; // already running

  btnStart?.setAttribute('disabled', '');
  btnStop?.removeAttribute('disabled');

  text(outBox, ''); text(statsBox, '');
  mountProgressBar(ANCHOR, BAR_ID, 'after');
  resetProgress(BAR_ID);
  startTimer();

  const addresses = readLines(addrBox);
  const total = addresses.length || 1;
  const seen = new Set();

  abortCtrl = new AbortController();
  const { signal } = abortCtrl;

  let res;
  try {
    res = await fetch('/api/marketSentimentStream', {
      method  : 'POST', signal,
      headers : { 'Content-Type':'application/json' },
      body    : JSON.stringify({ addresses })
    });
  } catch (err) {
    if (err.name !== 'AbortError') text(statsBox, `❌ ${err.message}`);
    cleanup(); return;
  }

  if (!res.body) { text(statsBox,'❌ no response body'); cleanup(); return; }

  reader = res.body.getReader();
  const dec = new TextDecoder(); let buf = '';

  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream:true });

      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
        if (!line) continue;
        let j; try { j = JSON.parse(line); } catch { continue; }

        if (j.type === 'log') {
          append(statsBox, line + '\n');
          if (j.wallet && !seen.has(j.wallet)) {
            seen.add(j.wallet);
            setProgress(BAR_ID, seen.size / total);
          }
        }
        if (j.type === 'partial') {
          outBox.textContent = `long ${j.longPct}% • short ${j.shortPct}% (after ${j.processed}/${total})`;
        }
        if (j.type === 'summary' || j.sentiment) {
          outBox.textContent = JSON.stringify(j.sentiment || j, null, 2);
          setProgress(BAR_ID, 1);
          cleanup();
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') console.error('[sentiment] stream error', err);
    cleanup();
  }
}

/* ============================================================ */
/*  3 · STOP STREAM                                             */
/* ============================================================ */
function stopSentimentStream () {
  if (!abortCtrl) return;
  abortCtrl.abort(); reader?.cancel().catch(()=>{}); cleanup();
}

/* ─────────────────────────────  cleanup  ───────────────────────────── */
function cleanup () {
  abortCtrl = null; reader = null;
  stopTimer(); setProgress(BAR_ID, 0);
  btnStart?.removeAttribute('disabled');
  btnStop?.setAttribute('disabled', '');
}
