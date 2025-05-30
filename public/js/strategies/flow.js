// js/strategies/flow.js
// Streams /api/flowStream and shows live flow tape + simple A/E bias pill,
// plus periodic coinData fetch for open interest & funding.

import { $, append } from '../core/dom.js';

/* ── DOM handles ────────────────────────────────────────── */
const out       = $('flow-output');
if (out) {
  out.style.maxHeight  = '60vh';
  out.style.overflowY  = 'auto';
  out.style.background = '#f0f0f0';
  out.style.padding    = '8px';
}

const coinI     = $('flow-coin');
const btnGo     = $('flow-start');
const btnStop   = $('flow-stop');

const biasWrap  = $('flow-bias-wrap');
if (biasWrap) {
  biasWrap.insertAdjacentHTML('beforeend', '<div id="flow-bias-line"></div>');
}
const biasLine  = $('flow-bias-line');
const biasLabel = $('flow-bias-label');

// coin-data header (shows OI, funding, mark price)
let coinHeader = null;
if (out) {
  coinHeader = document.createElement('div');
  coinHeader.id = 'flow-coin-header';
  coinHeader.style.cssText = 'font:600 12px/18px monospace;padding:4px;margin-bottom:4px;';
  out.parentNode.insertBefore(coinHeader, out);
}

/* ── state ────────────────────────────────────────────────── */
const HISTORY_SIZE = 60;    // look-back 60 events
let historyAE      = [];    // stores recent 'A' (absorption) or 'E' (exhaustion)

/* ── helpers ─────────────────────────────────────────────── */
function appendLine(txt) {
  const sp = document.createElement('span');
  sp.textContent = txt + '\n';
  out.append(sp);
  out.scrollTop = out.scrollHeight;
}

function recordAE(type) {
  historyAE.unshift(type);
  if (historyAE.length > HISTORY_SIZE) historyAE.pop();
  renderBias();
}

function renderBias() {
  const total  = historyAE.length;
  const countA = historyAE.filter(x => x === 'A').length;
  const ratioA = total ? countA / total : 0.5;
  if (biasLine) biasLine.style.left = `${ratioA * 100}%`;
  biasLabel.textContent = `↑${Math.round(ratioA * 100)}% · ↓${100 - Math.round(ratioA * 100)}%`;
}

/* ── fetch & render coin data (OI + funding + mark) ──────── */
async function loadCoinData() {
  try {
    const coin = encodeURIComponent(
      document.getElementById('flow-coin').value.trim()
    );
    const res  = await fetch(`/api/coinData?coin=${coin}`);
    const data = await res.json();       // { openInterest, fundingRate, markPrice }

    // only touch the .textContent of the <span>, never call toLocaleString on null
    const oiEl      = document.getElementById('flow-oi');
    const fundEl    = document.getElementById('flow-funding');
    const markEl    = document.getElementById('flow-mark');

    if (oiEl)   oiEl.textContent   = data.openInterest  != null
                                    ? data.openInterest.toLocaleString() 
                                    : '–';
    if (fundEl) fundEl.textContent = data.fundingRate   != null
                                    ? data.fundingRate .toLocaleString() 
                                    : '–';
    if (markEl) markEl.textContent = data.markPrice     != null
                                    ? data.markPrice   .toLocaleString() 
                                    : '–';

  } catch (err) {
    console.warn('coinData load error', err);
  }
}


/* ── SSE stream of flow events ───────────────────────────── */
function startFlow(coin) {
  const src = new EventSource(`/api/flowStream?coin=${coin}`);
  src.onmessage = ({ data }) => {
    let msg;
    try { msg = JSON.parse(data); }
    catch { appendLine(data); return; }

    // only handle absorption/exhaustion events
    if (msg.type === 'absorption' || msg.type === 'exhaustion') {
      const ts = new Date(msg.ts || Date.now()).toLocaleTimeString();
      appendLine(
        `[${ts}] ${msg.type} ${msg.side} $${msg.notional.toFixed(0)} @ ${msg.price}`
      );
      recordAE(msg.type === 'absorption' ? 'A' : 'E');
    }
  };
  src.onerror = () => appendLine('❌ flow stream error — reconnecting…');
  return src;
}

/* ── UI wiring (Start / Stop) ────────────────────────────── */
let src, coinPollTimer;

btnGo?.addEventListener('click', () => {
  if (src) return;
  const coin = (coinI.value || 'BTC-PERP').trim().toUpperCase();
  appendLine(`▶ Starting flow stream for ${coin} …`);
  loadCoinData(coin);
  // refresh coin data every 60s
  coinPollTimer = setInterval(() => loadCoinData(coin), 60_000);
  src = startFlow(coin);
});

btnStop?.addEventListener('click', () => {
  if (!src) return;
  src.close();
  src = null;
  clearInterval(coinPollTimer);
  appendLine('⏹ flow stream stopped');
});

/* ── initialize on page load ───────────────────────────── */
if (coinHeader && coinI) {
  const initCoin = (coinI.value || 'BTC-PERP').trim().toUpperCase();
  loadCoinData(initCoin).catch(() => {});
}
