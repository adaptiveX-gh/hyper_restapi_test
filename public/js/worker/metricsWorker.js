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

const BIG_MULT = 3;                                  // “3 × normal” flag

function bigPrintThreshold () {
  /* rolling 90-th pct × multiplier → adaptive “huge print” threshold */
  const p90 = sizeStats.pct(0.9) || 20_000;
  return BIG_MULT * p90;
}

/*───────────────────────────────────────────────────────────────
 * Message pump
 *───────────────────────────────────────────────────────────────*/
self.onmessage = ({ data }) => {
  switch (data.type) {

    /* 1. UI changed a knob – merge new cfg ................................*/
    case 'config':
      Object.assign(cfg, data.payload);
      return;

    /* 2. Depth snapshot  { bidDepth, askDepth, ts } ........................*/
    case 'depthSnap': {
      const snap = data.payload;
      depthStats.push(snap.bidDepth + snap.askDepth);

      /* ship back freshly recalculated scalers                              */
      self.postMessage({ type:'adapt', payload: recalcAdaptive() });
      return;
    }

    /* 3. Trade / flow event  { side, notional, kind, ts } .................*/
    case 'trade': {
      const t = data.payload;
      sizeStats.push(t.notional);

      /* 3-a  Scenario sign buffers (only the quick ones the worker owns) */
      if (t.kind === 'absorption')
        push(buf.c, t.side === 'buy' ?  1 : -1, cfg.WINDOW);

      if (t.kind === 'exhaustion')
        push(buf.w, t.side === 'buy' ? -1 :  1, cfg.WINDOW);

      /* (If you later migrate s / f into the worker, slot code here) */

      /* 3-b  Aggregate gauges & emit ......................................*/
      self.postMessage({
        type    : 'gauges',
        payload : {
          confirm : fastAvg(buf.c),
          warn    : fastAvg(buf.w),
          squeeze : fastAvg(buf.s),
          fake    : fastAvg(buf.f)
        }
      });

      /* 3-c  Detect “huge” prints and emit anomaly descriptor .............*/
      const huge = t.notional >= bigPrintThreshold();
      if (huge && (t.kind === 'absorption' || t.kind === 'exhaustion')) {
        self.postMessage({
          type    : 'anomaly',
          payload : {
            ts   : t.ts || Date.now(),       // fall back to now if missing
            side : t.side,                   // 'buy' | 'sell'
            size : t.notional,
            kind : t.kind === 'absorption' ? 'abs' : 'exh'
          }
        });
      }
      return;
    }

    /* 4. Default – ignore unknown message types ...........................*/
  }
};

/* inside metricsWorker.js – runs off-thread */
let BUF = [];                 // [{ts, val}]
const MAX = 900;              // 15-min @ 1-Hz
const HORIZON = 120 * 1000;   // project 2 min

self.onmessage = ({data}) => {
  if (data.type === 'cfdPoint') {
    BUF.push({ ts: data.ts, val: data.val });
    if (BUF.length > MAX) BUF.shift();
    forecastAndPost();
  }
};

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
