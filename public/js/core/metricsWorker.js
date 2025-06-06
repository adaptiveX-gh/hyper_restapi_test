/*───────────────────────────────────────────────────────────────*\
  metricsWorker.js – CPU-heavy number cruncher for the dashboard
  ▸ ES-module worker  (spawned with  new Worker(url, { type:'module' }) )
  ▸ Pure maths – ZERO DOM or Highcharts calls
  ▸ Emits three message types:
        •  adapt   – live adaptive thresholds
        •  gauges  – fast-avg scenario scores
        •  anomaly – “3 × normal” absorptions / exhaustions
\*───────────────────────────────────────────────────────────────*/

import { RollingStats } from '../lib/rollingStats.js';   // path is from /js/worker

self.addEventListener('message', m =>
  console.debug('[worker ⇐ main]', m.data.type, m.data)
);



/*───────────────────────────────────────────────────────────────
 * Rolling windows
 *───────────────────────────────────────────────────────────────*/
const sizeStats  = new RollingStats(600);   // ~5-10 min of trade prints
const depthStats = new RollingStats(120);   // ~2 min of 1-sec book snaps

/* push helper for the small sign buffers */
const buf = { c: [], w: [], s: [], f: [] };
const push = (a, v, max) => { a.push(v); if (a.length > max) a.shift(); };

let lastTradePx = NaN;
let lastMPD     = 0;

/*───────────────────────────────────────────────────────────────
 * Tunables (mutable from main thread)
 *───────────────────────────────────────────────────────────────*/
let cfg = {
  WINDOW          : 50,
  DEPTH_PARAM     : 25,
  VOL_WINDOW      : 60_000,   // (not yet used in worker)
  FALSE_ABS       : 200_000,  // will be auto-adapted
  FALSE_NEUTRAL   : 1_200,    // ms
  MOM_COUNT_THRESH: 30
};

/*───────────────────────────────────────────────────────────────
 * Adaptive yard-sticks
 *───────────────────────────────────────────────────────────────*/
function recalcAdaptive () {
  const SAFE = (v, fb) => (Number.isFinite(v) ? v : fb);

  const depthStd   = SAFE(depthStats.std(), 1e6);
  const p90Size    = SAFE(sizeStats.pct(0.9), 20_000);

  const FALSE_ABS        = Math.max(25_000, p90Size);       // big-print cut-off
  const printRate        = sizeStats.count / 300;           // prints / sec
  const FALSE_NEUT       = Math.max(800, 1_200 / Math.max(printRate, 0.2));
  const MOM_THRESH       = Math.max(5, sizeStats.pct(0.90));
  const FULL_SCALE_SLOPE = Math.max(1e5, 2 * depthStd);

  return { FALSE_ABS, FALSE_NEUT, MOM_THRESH, FULL_SCALE_SLOPE };
}

/*───────────────────────────────────────────────────────────────
 * Micro helpers
 *───────────────────────────────────────────────────────────────*/
const fastAvg = (arr, lookBack = 25) => {
  const n = Math.min(arr.length, lookBack);
  if (!n) return 0;
  let s = 0;
  for (let i = arr.length - n; i < arr.length; i++) s += arr[i];
  return s / n;
};

const pct = v => Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));

const BIG_MULT = 3;                                  // “3 × normal” flag

const MULT = 5;         // 5× adaptive threshold

const BABY_WHALE_USD = 150_000;

function routeMegaWhale(t) {
  const notional = Number(t.notional ?? (t.price * t.size));
  const big = Number(cfg.FALSE_ABS);
  if (!Number.isFinite(notional) || !Number.isFinite(big)) return;
  if (notional < MULT * big) return;

  const strength = Math.min(3, notional / (MULT * big));
  self.postMessage({
    type: 'anomaly',
    payload: {
      ts: t.ts,
      side: t.side,
      size: notional,
      kind: t.side === 'buy' ? 'mega_whale_up' : 'mega_whale_down',
      strength
    }
  });
}

function routeBabyWhale(t) {
  const notional = Number(t.notional ?? (t.price * t.size));
  if (!Number.isFinite(notional)) return;
  const isTop = t.kind === 'top';
  if (!isTop && notional < BABY_WHALE_USD) return;

  const strength = Math.min(1, notional / 300_000);
  console.debug('[worker] baby whale', { side: t.side, notional, strength, top: isTop });
  self.postMessage({
    type: 'anomaly',
    payload: {
      ts: t.ts,
      side: t.side,
      size: notional,
      kind: t.side === 'buy' ? 'baby_whale_up' : 'baby_whale_down',
      strength
    }
  });
}

function bigPrintThreshold () {
  /* rolling 90-th pct × multiplier → adaptive “huge print” threshold */
  const p90 = sizeStats.pct(0.9) || 20_000;
  return BIG_MULT * p90;
}

function processDepth (snap) {
  const total = snap.bidDepth + snap.askDepth;
  depthStats.push(total);
  if (Number.isFinite(lastTradePx) && total > 0) {
    const microPx = (
      snap.topBid * snap.askDepth + snap.topAsk * snap.bidDepth
    ) / total;
    lastMPD = ((microPx / lastTradePx) - 1) * 1e4;
  }
  self.postMessage({ type:'adapt', payload: recalcAdaptive() });
}

function processTrade (t) {
  sizeStats.push(t.notional);
  if (Number.isFinite(t.price)) lastTradePx = t.price;
  routeMegaWhale(t);
  routeBabyWhale(t);

  const huge = t.notional >= bigPrintThreshold();
  if (huge && (t.kind === 'absorption' || t.kind === 'exhaustion')) {
    self.postMessage({
      type    : 'anomaly',
      payload : {
        ts   : t.ts || Date.now(),
        side : t.side,
        size : t.notional,
        kind : t.kind === 'absorption' ? 'abs' : 'exh'
      }
    });
  }

  if (t.kind === 'absorption')
    push(buf.c, t.side === 'buy' ? 1 : -1, cfg.WINDOW);

  if (t.kind === 'exhaustion')
    push(buf.w, t.side === 'buy' ? -1 : 1, cfg.WINDOW);
}

function snapshot () {
  const confirm = fastAvg(buf.c);
  const warn    = fastAvg(buf.w);
  const squeeze = fastAvg(buf.s);
  const fake    = fastAvg(buf.f);
  const raw = [confirm, warn, squeeze, fake];
  const W = [1.4,1.2,1.0,1.0];
  const sumW = W.reduce((a,b)=>a+b,0);
  const amplify = 1.5;
  const bullPct = pct(amplify * raw.reduce((s,v,i)=>s + Math.max(0, v)*W[i],0) / sumW * 100);
  const bearPct = pct(amplify * raw.reduce((s,v,i)=>s + Math.max(0,-v)*W[i],0) / sumW * 100);
  return { confirm, warn, squeeze, fake, MPD:lastMPD, bullPct, bearPct };
}

setInterval(() => self.postMessage({ type:'snapshot', payload: snapshot() }), 200);

/*───────────────────────────────────────────────────────────────
 * Message pump
 *───────────────────────────────────────────────────────────────*/
self.onmessage = ({ data }) => {
  switch (data.type) {
    case 'config':
      Object.assign(cfg, data.payload);
      break;
    case 'depthSnap':
      processDepth(data.payload);
      break;
    case 'trade':
      processTrade(data.payload);
      break;
  }
};

/* inside metricsWorker.js – runs off-thread */
let BUF = [];                 // [{ts, val}]
const MAX = 900;              // 15-min @ 1-Hz
const HORIZON = 120 * 1000;   // project 2 min


 self.addEventListener('message', ({ data }) => {
   if (data.type !== 'cfdPoint') return;

   BUF.push({ ts: Number(data.ts), val: data.val });
   if (BUF.length > MAX) BUF.shift();
   forecastAndPost();
 });

function forecastAndPost () {
  console.debug('BUF length', BUF.length);
  if (BUF.length < 10) return;    // need a bit of history

  // --- 1) ordinary least squares on the last 90 s ------------
  const span = 30;                               // seconds
  const slice = BUF.slice(-span);
  const n = slice.length;
  const t0 = slice[0].ts;

  let Sx = 0, Sy = 0, Sxx = 0, Sxy = 0;
  slice.forEach((p,i) => {
    const x = (p.ts - t0) / 1000;   // seconds since t0
    const y = p.val;
    Sx  += x;  Sy  += y;
    Sxx += x*x; Sxy += x*y;
  });
  const denom = n*Sxx - Sx*Sx;
  if (!denom) return;

  const a = (n*Sxy - Sx*Sy)/denom;   // slope
  const b = (Sy - a*Sx)/n;           // intercept

  // crude RMSE for ±σ bands
  let mse = 0;
  slice.forEach(p=>{
    const x = (p.ts - t0)/1000;
    const yHat = a*x + b;
    mse += (p.val - yHat)**2;
  });
  const sigma = Math.sqrt(mse/n);

  // --- 2) build forecast points --------------------------------
  const step = 1000;                 // 1 s spacing
  const pts = [];
  for (let dt = step; dt <= HORIZON; dt += step) {
    const x = (dt)/1000;
    const y = a*x + b;
    pts.push([ t0 + dt, y ]);
  }

  const upper = pts.map(([t,y]) => [t, y + sigma]);
  const lower = pts.map(([t,y]) => [t, y - sigma]);

  // --- 3) send back to main thread -----------------------------
  self.postMessage({
    type : 'cfdForecast',
    payload : { base: pts, up: upper, lo: lower }
  });
}

export { routeBabyWhale, processTrade, processDepth, snapshot }; // make testable
