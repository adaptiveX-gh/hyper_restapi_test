/*───────────────────────────────────────────────────────────────*\
  metricsWorker.js  –  number-cruncher for the OBI / Flow dashboard
  Runs in its own thread (spawned with   new Worker('…', { type:'module' })).
  No DOM / Highcharts code here – just maths and messaging.
\*───────────────────────────────────────────────────────────────*/

import { RollingStats } from '../lib/rollingStats.js';   // relative to this file

/* ──────────────────────────────
 *  rolling buffers & state
 * ────────────────────────────── */
const sizeStats  = new RollingStats(600);   // ~5-10 min of trade prints
const depthStats = new RollingStats(120);   // ~2 min of 1-s book snapshots

const buf = { c: [], w: [], s: [], f: [], r: [], shock: [] };
const push = (a, v, max) => { a.push(v); if (a.length > max) a.shift(); };

/* live config that the main thread can update */
let cfg = {
  WINDOW          : 50,
  DEPTH_PARAM     : 25,
  VOL_WINDOW      : 60_000,
  FALSE_ABS       : 200_000,
  FALSE_NEUTRAL   : 1_200,     // ms
  MOM_COUNT_THRESH: 30
};

/* ──────────────────────────────
 *  adaptive thresholds (same math as before)
 * ────────────────────────────── */
function recalcAdaptive () {
  const SAFE = (v, fb) => (Number.isFinite(v) ? v : fb);

  const depthStd         = SAFE(depthStats.std(), 1e6);
  const p90Size          = SAFE(sizeStats.pct(0.9), 20_000);

  const FALSE_ABS        = Math.max(25_000, p90Size);

  const printRate        = sizeStats.buf.length / 300;      // prints / sec
  const FALSE_NEUT       = Math.max(800, 1_200 / Math.max(printRate, 0.2));

  const MOM_THRESH       = Math.max(5, sizeStats.pct(0.90));
  const FULL_SCALE_SLOPE = Math.max(1e5, 2 * depthStats.std());

  return { FALSE_ABS, FALSE_NEUT, MOM_THRESH, FULL_SCALE_SLOPE };
}

/* ──────────────────────────────
 *  helpers
 * ────────────────────────────── */
const fastAvg = (arr, lookBack = 25) => {
  const n = Math.min(arr.length, lookBack);
  return n ? arr.slice(-n).reduce((s, x) => s + x, 0) / n : 0;
};

/* ──────────────────────────────
 *  inbound messages from main thread
 * ────────────────────────────── */
self.onmessage = ({ data }) => {
  switch (data.type) {

    /* main thread pushes tunables whenever UI changes */
    case 'config':
      Object.assign(cfg, data.payload);
      return;

    /* order-book depth snapshot   { bidDepth, askDepth, ts } */
    case 'depthSnap': {
      const snap = data.payload;
      depthStats.push(snap.bidDepth + snap.askDepth);

      /* emit fresh adaptive thresholds */
      self.postMessage({ type: 'adapt', payload: recalcAdaptive() });
      return;
    }

    /* trade / flow event – pared down to essentials the worker needs */
    case 'trade': {
      const t = data.payload;               // { side, notional, kind }
      sizeStats.push(t.notional);

      /* replicate your previous classification logic */
      if (t.kind === 'absorption')
        push(buf.c, t.side === 'buy' ?  1 : -1, cfg.WINDOW);

      if (t.kind === 'exhaustion')
        push(buf.w, t.side === 'buy' ? -1 :  1, cfg.WINDOW);

      /*  ✱  TODO:   add squeeze / fake / shock population here
          if you want the worker to own those too                 */

      /* aggregate quick gauge values */
      const gauges = {
        confirm : fastAvg(buf.c),
        warn    : fastAvg(buf.w),
        squeeze : fastAvg(buf.s),
        fake    : fastAvg(buf.f)
      };

      self.postMessage({ type: 'gauges', payload: gauges });
      return;
    }
  }
};
