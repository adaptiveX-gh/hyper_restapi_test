/*───────────────────────────────────────────────────────────────*
 *  metricsWorker – crunches numbers for OBI / Flow dashboard    *
 *  Runs in its own thread.  No DOM / Highcharts code here!      *
 *───────────────────────────────────────────────────────────────*/

importScripts('../lib/rollingStats.js');        // tiny helper you already had

// ── state mirrors the old buffers ───────────────────────────────
const sizeStats  = new RollingStats(600);       // ≈ 5-10 min prints
const depthStats = new RollingStats(120);       // 2 min of book snaps
const buf = { c: [], w: [], s: [], f: [], r: [], shock: [] };
const push = (arr, v, max) => { arr.push(v); if (arr.length > max) arr.shift(); };

let config = {
  WINDOW:50, DEPTH_PARAM:25, VOL_WINDOW:60_000,
  FALSE_ABS:200_000, FALSE_NEUTRAL:1_200, MOM_COUNT_THRESH:30
};

// helper – recompute adaptive thresholds exactly like before
function recalcAdaptive () {
  const SAFE = (v,fallback)=>Number.isFinite(v)?v:fallback;
  const depthStd = SAFE(depthStats.std(),1e6);
  const p90Size  = SAFE(sizeStats.pct(0.9),20_000);
  const FALSE_ABS = Math.max(25_000, p90Size);

  const printRate = sizeStats.buf.length / 300;          // prints/sec
  const FALSE_NEUT = Math.max(800, 1_200 / Math.max(printRate,0.2));

  const MOM_THRESH = Math.max(5, sizeStats.pct(0.90));
  const FULL_SCALE_SLOPE = Math.max(1e5, 2 * depthStats.std());

  return { FALSE_ABS, FALSE_NEUT, MOM_THRESH, FULL_SCALE_SLOPE };
}

// ── message handler – main thread feeds us raw events ───────────
self.onmessage = ({ data }) => {
  if (data.type === 'config') {            // update tunables
    Object.assign(config, data.payload);
    return;
  }
  if (data.type === 'depthSnap') {         // {bidDepth,askDepth,ts}
    depthStats.push(data.payload.bidDepth + data.payload.askDepth);
    self.postMessage({ type:'adapt', payload: recalcAdaptive() });
    return;
  }
  if (data.type === 'trade') {             // flow event (simplified)
    const t = data.payload;
    sizeStats.push(t.notional);

    /*  replicate exactly the flag logic you had  */
    if (t.kind === 'absorption') {
      push(buf.c, t.side === 'buy' ? 1 : -1, config.WINDOW);
    }
    if (t.kind === 'exhaustion') {
      push(buf.w, t.side === 'buy' ? -1 : 1, config.WINDOW);
    }
    // … squeeze / fake / shock etc. – same rules …

    // aggregate scenario scores for gauges
    const fastAvg = a => {
      const n = Math.min(a.length, 25);
      return n ? a.slice(-n).reduce((s,x)=>s+x,0)/n : 0;
    };
    const out = {
      confirm : fastAvg(buf.c),
      warn    : fastAvg(buf.w),
      squeeze : fastAvg(buf.s),
      fake    : fastAvg(buf.f)
      // add more if you off-load them
    };
    self.postMessage({ type:'gauges', payload: out });
  }
};
