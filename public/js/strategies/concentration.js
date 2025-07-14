/*  js/strategies/concentration.js
    ─────────────────────────────────────────────────────────────
    Asset-Concentration pane – start / stop stream + progress & timer
*/

import { $, append, text, readLines, downloadTextFile } from '../core/dom.js';
import { loadSheetAddresses }          from '../core/api.js';
import { mountProgressBar, setProgress, resetProgress } from '../core/progress.js';

/* ─────────────────────────────  DOM refs  ───────────────────────────── */
const addrBox  = $('conc-addrs');
const outBox   = $('conc-output');
const statsBox = $('conc-stats');

const btnStart = $('conc-run');          // “Run Stream”
const btnStop  = $('conc-stop');         // NEW “Stop”  (disabled by default)

/* ids for bar + timer */
const BAR_ID   = 'conc-progress';
const TIMER_ID = 'conc-timer';
const ANCHOR   = 'conc-progress-anchor';

/* ─────────────────────────────  Event wiring  ───────────────────────── */
$('conc-load') ?.addEventListener('click', loadAddresses);
$('conc-download')?.addEventListener('click', downloadYaml);
btnStart       ?.addEventListener('click', startStream);
btnStop        ?.addEventListener('click', stopStream);

$('conc-clear-stats') ?.addEventListener('click', () => text(statsBox, ''));
$('conc-clear-results')?.addEventListener('click', () => text(outBox , ''));
$('conc-copy-stats')  ?.addEventListener('click', () => navigator.clipboard.writeText(statsBox.textContent));
$('conc-copy-output') ?.addEventListener('click', () => navigator.clipboard.writeText(outBox.textContent));

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
  const filters = { pnlMin:numOrU('conc-pnlMin'), winRateMin:numOrU('conc-winRateMin'), durationMin:numOrU('conc-durationMin') };
  try {
    const addrs = await loadSheetAddresses(filters);
    addrBox.value = addrs.join('\n');
    text(statsBox, `✅ ${addrs.length} addresses loaded`);
  } catch (err) {
    text(statsBox, `❌ ${err.message}`);
    console.error('[concentration] loadSheetAddresses failed', err);
  }
}

function downloadYaml () {
  const addrs = readLines(addrBox);
  if (!addrs.length) return;
  const yaml = addrs.map(a => `- address: "${a}"\n  threshold_usd: 50000`).join('\n');
  downloadTextFile('addresses.yml', yaml);
}

/* ============================================================ */
/*  2 · START STREAM                                            */
/* ============================================================ */
async function startStream () {
  if (abortCtrl) return;                       // already running

  btnStart?.setAttribute('disabled', '');
  btnStop ?.removeAttribute('disabled');

  text(outBox,  ''); text(statsBox,'');
  mountProgressBar(ANCHOR, BAR_ID, 'after');
  resetProgress(BAR_ID);
  startTimer();

  const addresses = readLines(addrBox);
  const total = addresses.length || 1;
  const seen  = new Set();

  abortCtrl = new AbortController();
  const { signal } = abortCtrl;

  let res;
  try {
    res = await fetch('/api/assetConcentrationStream', {
      method : 'POST', signal,
      headers: { 'Content-Type':'application/json' },
      body   : JSON.stringify({ addresses })
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

        if (j.type === 'summary') {
          text(outBox, JSON.stringify(j.concentration, null, 2) || '—');
          setProgress(BAR_ID, 1);
          cleanup();
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') console.error('[concentration] stream error', err);
    cleanup();
  }
}

/* ============================================================ */
/*  3 · STOP STREAM                                             */
/* ============================================================ */
function stopStream () {
  if (!abortCtrl) return;
  abortCtrl.abort(); reader?.cancel().catch(()=>{}); cleanup();
}

/* ─────────────────────────────  cleanup  ───────────────────────────── */
function cleanup () {
  abortCtrl = null; reader = null;
  stopTimer(); setProgress(BAR_ID, 0);
  btnStart?.removeAttribute('disabled');
  btnStop ?.setAttribute('disabled', '');
}
