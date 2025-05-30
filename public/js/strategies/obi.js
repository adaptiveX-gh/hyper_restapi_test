/*───────────────────────────────────────────────────────────────*
 *  js/strategies/obi.js – OBI + Flow-Tape dual-pane
 *  2025-06-02 – meters: ① confirmation ② early-warning
 *───────────────────────────────────────────────────────────────*/

import { $, text } from '../core/dom.js';
import { startPulse } from '../core/hlPulse.js';
import { startLiquidityWatcher } from '../core/liquidityWatcher.js';

let stopPulse = () => {};


/* ── DOM refs ─────────────────────────────────────────────── */
const coinI        = $('obi-coin');
const depthI       = $('obi-depth');
const perI         = $('obi-period');
const windowInput  = $('obi-window');            // rolling-window (ticks)

const obiAvgMeter  = $('obi-average-meter');     // avg-ratio bar
const confMeter    = $('meter-confirmation');    // meter #1  – confirmation
const warnMeter    = $('meter-earlywarn');       // meter #2  – early-warning ★ NEW
const falseMeter   = $('meter-falsebreak');      // meter #3
const squeezeMeter = $('meter-squeeze');         // meter #4 – squeeze-risk  ✅

/* headline ticker */
const tickerInner  = $('ticker-inner');          // created in HTML snippet

const btnObiStart  = $('obi-start');
const btnObiStop   = $('obi-stop');
const btnObiClear  = $('obi-clear');

const btnFlowStart = $('flow-start');
const btnFlowStop  = $('flow-stop');
const btnFlowClear = $('flow-clear');

const obiBox       = $('obi-output');
const flowBox      = $('flow-tape');

/* ── constants ────────────────────────────────────────────── */
const MIN_UI_NOTIONAL_USD       = 5_000;      // flow spam-guard
const FLOW_SCALE_NOTIONAL       = 500_000;    // full-width bar = $500k
const FALSE_ABS_NOTIONAL_USD    = 150_000;    // “big absorption” cut-off
const FALSE_NEUTRAL_SEC         = 10;         // book must stay neutral ≥ 10 s

/* ★ squeeze parameters */
const SQUEEZE_RATIO_HIGH        = 1.8;      // book extremely bid-heavy
const SQUEEZE_RATIO_LOW         = 0.55;     // book extremely ask-heavy
const SQUEEZE_STALE_SEC         = 5;        // extreme reading valid this many sec

/* remember last extreme imbalance (for squeeze) */
let lastExtreme = { side: 0, ts: 0 };    // +1 bid-heavy / –1 ask-heavy

/* 🚦 tiny pill after <h1> */
const liqPill = (() => {
  const s = document.createElement('span');
  s.style.cssText =
     'display:inline-block;width:12px;height:12px;margin-left:6px;'+
     'border-radius:50%;background:#777;vertical-align:middle;';
  document.querySelector('h1')?.append(s);
  return s;
})();

/* kick-off watcher (keep the stop fn if you ever need it) */
startLiquidityWatcher({
  symbolInput : coinI,
  pillEl      : liqPill,
  overlayTarget: document.body    // grey-out thin liquidity
});


/* ── helpers ─────────────────────────────────────────────── */
const prependLine = (box, txt, colour='') => {
  const span = document.createElement('span');
  if (colour) span.style.color = colour;
  span.textContent = txt + '\n';
  box.insertBefore(span, box.firstChild);
  box.scrollTop = 0;
};
const pushBuf = (b, v, n) => { b.push(v); if (b.length > n) b.shift(); };

/* ── rolling buffers ─────────────────────────────────────── */
let obiHeavyBuf = [];      // +1 / −1 / 0  (for confirmation bar)
let absSideBuf  = [];      // +1 / −1 / 0  (confirmation bar)
let warnBuf     = [];      // +1 / −1 / 0  (early-warning bar)
let falseBuf    = [];      // rolling buffer for meter #3
let squeezeBuf  = [];   // ★ squeeze

/* remember last book-heaviness reading so FLOW handler can access it */
let lastHeaviness = 0;
let lastNeutralTime = 0;   

/* ── meter painters ───────────────────────────────────────── */
function paintBar(el, bull, bear) {
  el.innerHTML   = '';
  el.className   = 'meter';
  const bearDiv  = document.createElement('div');
  const bullDiv  = document.createElement('div');
  bearDiv.className = 'meter-bear';
  bullDiv.className = 'meter-bull';
  bearDiv.style.width = (bear*100).toFixed(1) + '%';
  bullDiv.style.width = (bull*100).toFixed(1) + '%';
  el.append(bearDiv, bullDiv);
}

function renderConfirmationMeter() {
  const N = parseInt(windowInput?.value, 10) || 20;
  if (obiHeavyBuf.length < N || absSideBuf.length < N) return;

  const obiAvg = obiHeavyBuf.reduce((s,v)=>s+v,0)/N;
  const absAvg = absSideBuf.reduce((s,v)=>s+v,0)/N;

  const bull = Math.min(obiAvg, absAvg)  > 0 ? Math.min(obiAvg, absAvg)  : 0;
  const bear = Math.max(obiAvg, absAvg)  < 0 ? Math.abs(Math.max(obiAvg, absAvg)) : 0;

  paintBar(confMeter, bull, bear);
  confMeter.title =
    `Confirmation\n· bullish ${bull.toFixed(2)}\n· bearish ${bear.toFixed(2)}\n` +
    `(OBI ${obiAvg.toFixed(2)}, absorption ${absAvg.toFixed(2)})`;
}

/* early-warning = ‘neutral book + one-sided exhaustion’ */
function renderEarlyWarnMeter () {       // (keep the exact name you call later)
  const N = parseInt(windowInput?.value, 10) || 20;
  if (warnBuf.length < N) return;   // use *warnBuf* here

  const avg  = warnBuf.reduce((a,b)=>a+b,0) / N;   // –1 … +1
  const bull = avg > 0 ?  avg : 0;
  const bear = avg < 0 ? -avg : 0;

  const bar = document.getElementById('meter-earlywarn');
  bar.innerHTML = '';
  bar.className = 'meter';

  const bearDiv = document.createElement('div');
  bearDiv.className = 'meter-bear';
  bearDiv.style.width = (bear*100).toFixed(1)+'%';

  const bullDiv = document.createElement('div');
  bullDiv.className = 'meter-bull';
  bullDiv.style.width = (bull*100).toFixed(1)+'%';

  bar.append(bearDiv, bullDiv);
  bar.title = `Early-Warning  bullish=${bull.toFixed(2)}, bearish=${bear.toFixed(2)}`;
}

/* 🆕 False-Move meter painter */
function renderFalseMoveMeter() {
  const N = parseInt(windowInput?.value,10) || 20;
  if (falseBuf.length < N) return;

  const avg = falseBuf.reduce((s,v)=>s+v,0) / N;
  const bull = avg > 0 ?  avg : 0;
  const bear = avg < 0 ? -avg : 0;

  paintBar(falseMeter, bull, bear);
  falseMeter.title =
    `False-Move filter\n· bullish ${bull.toFixed(2)}  · bearish ${bear.toFixed(2)}`;
}

function renderSqueezeMeter () {
  const N = parseInt(windowInput?.value, 10) || 20;
  if (squeezeBuf.length < N) return;
  const avg  = squeezeBuf.reduce((a,b)=>a+b,0) / N;
  paintBar(squeezeMeter, avg>0?avg:0, avg<0?-avg:0);
  squeezeMeter.title =
    `Squeeze meter  bullish ${Math.max(0,avg).toFixed(2)}, ` +
    `bearish ${Math.max(0,-avg).toFixed(2)}`;
}


/* ── ticker helpers ─────────────────────────────────────── */
function addTickerMsg(msg,colour='#eee'){
  const span=document.createElement('span');
  span.textContent=' '+msg+' •';
  span.style.color=colour;
  tickerInner.append(span);
  /* keep inner span from growing forever */
  if(tickerInner.childNodes.length>60) tickerInner.removeChild(tickerInner.firstChild);
}

function writeMicroFlags({ volSpike, oiSpike, depthThin }) {
  const flagLine = [
    volSpike  ? 'VOL ×'  : '',
    oiSpike   ? 'OI ⚡'   : '',
    depthThin ? 'THIN bk': '',
  ].filter(Boolean).join(' ');
  if (flagLine) addTickerMsg(flagLine, '#ffbe55');
}

/* map current fill to ±100 */
function barFill(el){
  const bear=el.querySelector('.meter-bear');
  const bull=el.querySelector('.meter-bull');
  if(!bear||!bull) return 0;
  return (parseFloat(bull.style.width)||0) - (parseFloat(bear.style.width)||0);
}

/* append somewhere near playByPlay(); */
function handlePulse(p){
  if (p.volSpike || p.oiSpike || p.depthThin){
    // show a quick toaster & tint ticker
    const tag = [
      p.volSpike  ? 'VOL ×'  : '',
      p.oiSpike   ? 'OI ⚡'   : '',
      p.depthThin ? 'THIN bk': ''
    ].filter(Boolean).join(' / ');
    addTickerMsg(`NEWS-PULSE ► ${tag}`, '#ffd166');
    /* optional: relax filters when things go nuts */
    MIN_UI_NOTIONAL_USD = p.volSpike ? 2000 : 5000;
  }
}

function playByPlay(){
  const c = barFill(confMeter),
        w = barFill(warnMeter),
        f = barFill(falseMeter),
        s = barFill(squeezeMeter);
  const bias = c*0.5 + w*0.2 + f*0.10 + s*0.20;
  let msg;
  if(Math.abs(bias)<15) msg='Market flat.';
  else if(bias>0 && bias<40) msg='Buyers probing.';
  else if(bias<0 && bias>-40) msg='Sellers probing.';
  else if(bias>0 && bias<70) msg='Upside pressure.';
  else if(bias<0 && bias>-70) msg='Downside pressure.';
  else msg = bias>0 ? '⚡ SQUEEZE RISK UP!' : '⚡ FLUSH RISK DOWN!';
  addTickerMsg(msg, bias>10?'#4dff88':bias<-10?'#ff4d4d':'#ccc');
}


/*─────────────────────────────────────────────────────────────*
 * 1 ░ OBI STREAM                                              *
 *─────────────────────────────────────────────────────────────*/
let obiEs;
function startObi() {
  if (obiEs) return;
  btnObiStart.disabled = true;
  btnObiStop.disabled  = false;
  btnObiClear.disabled = true;
  text(obiBox,'');
  prependLine(obiBox,'⏳ connecting to OBI stream…','dodgerblue');

  const N = parseInt(windowInput?.value,10)||20;
  obiHeavyBuf.length = 0;

  const url = `/api/obImbalanceLive`
            + `?coin=${encodeURIComponent(coinI.value)}`
            + `&depth=${depthI.value}&period=${perI.value}`;

  obiEs = new EventSource(url);

  obiEs.onmessage = ({ data }) => {
    let m; try{ m = JSON.parse(data); } catch { return; }
    if (typeof m.ratio !== 'number') return;

    /* heaviness for confirmation bar & for FLOW logic */
    const heaviness = m.ratio >= 1.4 ? +1
                   : m.ratio <= 0.6 ? -1
                   : 0;
    lastHeaviness = heaviness;
    
    /* 🆕 remember when book is neutral so Flow handler can test duration */
    if (heaviness === 0) lastNeutralTime = Date.now();

    /* ★ capture EXTREME imbalance for squeeze logic       */
    if(m.ratio>=SQUEEZE_RATIO_HIGH){
      lastExtreme={side:+1, ts:Date.now()};          // bid-heavy, asks thin
    } else if(m.ratio<=SQUEEZE_RATIO_LOW){
      lastExtreme={side:-1, ts:Date.now()};          // ask-heavy, bids thin
    }

    pushBuf(obiHeavyBuf, heaviness, N);
    renderConfirmationMeter();               // may repaint bar-#1

    /* per-tick UI (unchanged) */
    const tot = m.bidDepth + m.askDepth || 1;
    const pctBid = (m.bidDepth / tot * 100).toFixed(1) + '%';
    const pctAsk = (m.askDepth / tot * 100).toFixed(1) + '%';
    const meter = `<div class="meter-bear" style="width:${pctAsk}"></div>`
                + `<div class="meter-bull" style="width:${pctBid}"></div>`;

    const arrow  = heaviness === 1 ? '▲' : heaviness === -1 ? '▼' : '';
    const colour = heaviness === 1 ? 'limegreen'
                 : heaviness === -1 ? 'orangered' : '#333';

    const txt = `${new Date(m.ts).toLocaleTimeString()}  `
              + `ratio=${m.ratio.toFixed(2).padEnd(5)}  `
              + `bid=${m.bidDepth.toFixed(0).padStart(3)}  `
              + `ask=${m.askDepth.toFixed(0).padStart(3)}  ${arrow}\n`;

    const line = document.createElement('div');
    line.className = 'imbalance-line';
    line.innerHTML = `<div class="meter">${meter}</div><span style="color:${colour}">${txt}</span>`;
    obiBox.insertBefore(line, obiBox.firstChild);
  };

  obiEs.onerror = () => prependLine(obiBox,'⚠ OBI stream error…','crimson');
}
function stopObi(){
  if(!obiEs) return;
  obiEs.close(); obiEs = null;
  btnObiStart.disabled=false; btnObiStop.disabled=true; btnObiClear.disabled=false;
}
btnObiStart.addEventListener('click',startObi);
btnObiStop .addEventListener('click',stopObi);
btnObiClear.addEventListener('click',()=>text(obiBox,''));


/*─────────────────────────────────────────────────────────────*
 * 2 ░ FLOW-TAPE STREAM  (confirmation + early-warning)       *
 *─────────────────────────────────────────────────────────────*/
let flowEs;
async function startFlow () {
  /* after you disable the buttons but before you open flow WS */
  stopPulse();   // clean old
  stopPulse = startPulse(coinI.value, handlePulse);   // fresh watcher

  if (flowEs) return;
  btnFlowStart.disabled = true;
  btnFlowStop.disabled  = false;
  btnFlowClear.disabled = true;
  text(flowBox,'');
  prependLine(flowBox,'⏳ connecting to flow stream…','dodgerblue');

  /* CLEAR BUFFERS */
  warnBuf.length = 0;            // ← add this line
  absSideBuf .length = 0;             // (you may already have this one)
  falseBuf.length = 0;          // 
  squeezeBuf.length=0; 
  renderSqueezeMeter();
  renderEarlyWarnMeter();             // Optional: blank-out the bar
  renderConfirmationMeter();          // blank bar
  renderFalseMoveMeter();       // blank bar

  lastNeutralTime = Date.now();        // reset timer for false-move logic

  await fetch('/startFlow',{ method:'POST' }).catch(()=>{});
  flowEs = new EventSource('/api/flowStream');

  const N = parseInt(windowInput?.value,10)||20;

  flowEs.onmessage = ({ data }) => {
    if (data.trim().endsWith('heartbeat')) return;
    let m; try { m = JSON.parse(data); } catch { return; }

    if (!['absorption','exhaustion'].includes(m.type)) return;
    if (m.notional < MIN_UI_NOTIONAL_USD) return;

    /* ❶ confirmation buffer – absorption only */
    const absDir = (m.type==='absorption' && m.side==='buy')  ? +1      // ask-side absorbed → bearish
                 : (m.type==='absorption' && m.side==='sell') ? -1      // bid-side absorbed → bullish
                 : 0;
    pushBuf(absSideBuf, absDir, N);
    renderConfirmationMeter();

    /* ❷ early-warning buffer – neutral book + exhaustion */
    const isNeutral = lastHeaviness === 0;                    // book roughly flat
    let warnHit = 0;
    if (isNeutral && m.type === 'exhaustion') {
      warnHit = m.side === 'sell' ? +1  // ask take-out → bullish warn
             : m.side === 'buy'  ? -1  // bid take-out → bearish warn
             : 0;
    }
    pushBuf(warnBuf, warnHit, N);
    renderEarlyWarnMeter();

    /* ❸ per-tick rendering (colour with our agreed semantics) */ 
    /* idea: a “big” absorption occurs while book is neutral and
             STAYS neutral for ≥ FALSE_NEUTRAL_SEC afterwards       */
    let falseHit = 0;
    const now = Date.now();

    if (m.type === 'absorption' &&
        m.notional >= FALSE_ABS_NOTIONAL_USD &&
        (now - lastNeutralTime) >= FALSE_NEUTRAL_SEC * 1000) {

      /* book has been neutral long enough – classify direction */
      falseHit = m.side === 'sell' ? +1   // bid absorbed → pumps, usually false-break ↑
               : m.side === 'buy'  ? -1   // ask absorbed → dumps, usually false-break ↓
               : 0;
    }
    pushBuf(falseBuf, falseHit, parseInt(windowInput?.value,10)||20);
    renderFalseMoveMeter();

    /* ④ squeeze logic  ─────────────────────────────────── */
    let squeezeHit=0;
    if(m.type==='exhaustion'){                         // only exhaustions matter
      const age=(Date.now()-lastExtreme.ts)/1000;
      if(age<=SQUEEZE_STALE_SEC && lastExtreme.side){ // extreme still “fresh”
        if( lastExtreme.side=== +1 && m.side==='sell') squeezeHit=-1; // bullish squeeze
        if( lastExtreme.side=== -1 && m.side==='buy' ) squeezeHit=+1; // bearish squeeze
      }
    }
    pushBuf(squeezeBuf,squeezeHit,N);
    renderSqueezeMeter();

    playByPlay();

    /* per-tick rendering (colour with our agreed semantics) */
    const isBull =
          (m.type === 'absorption' && m.side === 'sell')   // bid-side absorption
       || (m.type === 'exhaustion'  && m.side === 'sell'); // ask take-out

    const frac     = Math.min(m.notional / FLOW_SCALE_NOTIONAL, 1);
    const wPct     = (frac*100).toFixed(1)+'%';
    const meter    = `<div class="meter-bear" style="width:${isBull?'0%':wPct}"></div>`
                   + `<div class="meter-bull" style="width:${isBull?wPct:'0%'}"></div>`;

    const arrow  = isBull ? '▲' : '▼';
    const colour = isBull ? 'limegreen' : 'orangered';

    const t = new Date(m.ts).toLocaleTimeString();
    const notk = (m.notional/1e3).toFixed(0);
    const txt = `[${t}] ${m.side.padStart(4)}  $${notk}k  ${m.type}@${m.price.toFixed(0)}  ${arrow}\n`;

    const line = document.createElement('div');
    line.className = 'imbalance-line';
    line.innerHTML = `<div class="meter">${meter}</div><span style="color:${colour}">${txt}</span>`;
    flowBox.insertBefore(line, flowBox.firstChild);

        /* ────────────────────────────────────────────────────────────────
    * 2 ░ inside flowEs.onmessage – just *after* you create `m`
    *    (append these few lines, nothing else changes)
    *────────────────────────────────────────────────────────────────*/
    const volSpike  = m.volume24h && m.volume24h > 5 * (m.avgVol24h || 1);   // example rule
    const oiSpike   = m.openInterest && m.openInterestChgPct > 0.8;          // > 0.8 % jump
    const depthThin = window.__RLI !== undefined && window.__RLI < 0.30;     // from watcher

    writeMicroFlags({ volSpike, oiSpike, depthThin });

  };

  flowEs.onerror = () => prependLine(flowBox,'⚠ flow stream error…','crimson');
}
async function stopFlow(){
  if (!flowEs) return;
  await fetch('/stopFlow',{method:'POST'}).catch(()=>{});
  flowEs.close(); flowEs = null;
  btnFlowStart.disabled=false; btnFlowStop.disabled=true; btnFlowClear.disabled=false;
}
btnFlowStart.addEventListener('click',startFlow);
btnFlowStop .addEventListener('click',stopFlow);
btnFlowClear.addEventListener('click',()=>text(flowBox,''));
