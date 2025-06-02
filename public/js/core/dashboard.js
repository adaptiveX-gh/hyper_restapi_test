
    import { onCtx, onCandle } from './perpDataFeed.js';
import { BookBiasLine } from '../lib/bookBiasLine.js';
import { classifyObi, classifyBias } from "./utils.js";
import { formatCompact } from '../lib/formatCompact.js';
import { stateOiFunding, stateStrength, paintDot } from '../lib/statusDots.js';
import { RollingBias } from '../lib/rollingBias.js';
import { BiasTimer } from '../lib/biasTimer.js';

    let obCFD = null;          // ← visible to every function in the module
    let price24hAgo = null;     // fetched once per coin switch
    let hlWs = null;          // keep a reference so we can close / restart

    // put near the top of dashboard.js – before updateBigTiles is ever called
    let LIQ_MEDIAN = NaN;     // <- will be filled once slow-stats arrives
    let VOL_MEDIAN = NaN;

  (function(){
    const P = {
      WINDOW          : 50,
      MIN_NOTIONAL    : 10_000,
      DEPTH_PARAM     : 25,
      DEPTH_BPS       : 0.0005,
      REFRESH_PERIOD  : 1,
      VOL_WINDOW      : 60_000,
      FALSE_ABS       : 200_000,
      FALSE_NEUTRAL   : 1_200,   // ms
      MOM_COUNT_THRESH: 30,
      FULL_SCALE_LAR  : 5e5,
      FULL_SCALE_SLOPE: 1e8
    };
    window.P = P;               // expose for quick console debugging

      
    /******************************************************************
    * RollingStats – push(x) then get median(), mean(), std(), pct(q)
    ******************************************************************/
    class RollingStats {
      constructor(size = 300) { this.size = size; this.buf = []; }
      push(x) { this.buf.push(x); if (this.buf.length > this.size) this.buf.shift(); }
      _sorted() { return [...this.buf].sort((a,b)=>a-b); }
      median()  { const s = this._sorted(); const m = s.length>>1;
                  return s.length ? (s.length%2 ? s[m] : 0.5*(s[m-1]+s[m])) : 0; }
      mean()    { return this.buf.reduce((a,b)=>a+b,0)/this.buf.length || 0; }
      std()     { const μ=this.mean(); return Math.sqrt(this.buf
                    .reduce((s,x)=>s+(x-μ)**2,0)/(this.buf.length||1)); }
      pct(q)    { const s=this._sorted(); return s.length?s[Math.floor(q*s.length)]:0; }
    }

    // ─────────────────────────────────────────────────────────────────────
    // HELPERS & STATE
    // ─────────────────────────────────────────────────────────────────────
    const $=id=>document.getElementById(id),
          fmtUsd=v=>'$'+(+v).toLocaleString(),
          setHtml=(id,t)=>{const e=$(id);if(e)e.textContent=t},
          dot=(id,c)=>{const e=$(id);if(e)e.className='status-dot '+c};

    const fastAvg = a => {             // 25-tick look-back
        const start = Math.max(0, a.length-25);
        let s = 0, n = 0;
        for (let i=start;i<a.length;i++){ s += a[i]; n++; }
        return n ? s/n : 0;
    };

    const makeUpd = (g, clamp = (x) => x) =>
      (v) => g.series[0].points[0].update(clamp(v));    
    
    let statsFeed = null;
    //  ==== 1. create once  ==========================================
    const CFD_CAP = 3_600;          // keep 1-hour @ 1-sec
    const cfdSeries = { bids: [], asks: [], imb: [], mid: [] };

    function addPoint(arr, point) {
      arr.push(point);
      if (arr.length > CFD_CAP) arr.shift();
    }

    function fmtDeltaPct(x) {
      return (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%';
    }

    const biasTimer = new BiasTimer('biasRollTimer');

function startPriceFeed(coin = 'BTC') {
  const COIN = coin.toUpperCase().replace(/-PERP$/, '');

  // 🔒 socket discipline: guarantee a clean slate before re-connecting
  stopPriceFeed();
  hlWs = new WebSocket('wss://api.hyperliquid.xyz/ws');

  hlWs.onopen = () => {
    const subMsg = {
      method: 'subscribe',
      subscription: { type: 'activeAssetCtx', coin: COIN }
    };
    hlWs.send(JSON.stringify(subMsg));
  };

  hlWs.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.channel !== 'activeAssetCtx') return;   // ignore other feeds

    /* ❶ pick the current price (oracle preferred, else mark) */
    const ctx = msg.data.ctx;
    const px  = Number(ctx.oraclePx || ctx.markPx);
    if (!px) return;

    /* ❷ live price */
    setHtml('priceLive', '$' + px.toLocaleString(undefined, {
      maximumFractionDigits: 2
    }));

    /* ❸ 24-h change (use prevDayPx from the same ctx) */
    const prev = Number(ctx.prevDayPx);
    if (prev) price24hAgo = prev;         // keep a copy for later if you need it

    if (price24hAgo) {
      const pct   = px / price24hAgo - 1;
      const el    = document.getElementById('price24h');
      el.textContent = (pct >= 0 ? '+' : '') + (pct * 100).toFixed(2) + '%';
      el.style.color = pct >= 0 ? '#28c76f' : '#ff5252';
    }
  };

  hlWs.onerror   = (e) => console.warn('[HL-WS]', e);
  hlWs.onclose   = () => console.log('[HL-WS] closed');
}

/* call `stopPriceFeed()` before unloading / switching coins */
function stopPriceFeed () {
  if (!hlWs) return;                        // nothing to do

  switch (hlWs.readyState) {
    case WebSocket.OPEN:                    // ⇢ live
    case WebSocket.CONNECTING:              // ⇢ still hand-shaking
      hlWs.close(1000, 'manual close');     // polite normal-closure
      break;

    case WebSocket.CLOSING:                 // ⇢ handshake already under way
      /* no-op — let the browser finish the close sequence */
      break;

    case WebSocket.CLOSED:
    default:
      /* already closed / never opened — ignore */
      break;
  }

  hlWs = null;                              // GC-friendly
}

/* safe -text writer : never crashes even if ID is missing */
function setTxt(id, txt) {
  const el = document.getElementById(id);
  if (!el) {                                     // guard against  null
    console.warn('[setTxt] missing element:', id);
    return;
  }
  el.textContent = txt;
}


        // ─── lightweight CFD updater ──────────────────────────────────────────
    function feedCFD(depthSnap) {
      if (!obCFD || obCFD.series.length < 4) return;   // safety guard

      const ts   = Number(depthSnap.ts) || Date.now();   // ← fallback
      const bidN = depthSnap.bidDepth;
      const askN = depthSnap.askDepth;
      const mid  = (depthSnap.topBid + depthSnap.topAsk) / 2;
      
      worker.postMessage({ type:'cfdPoint', ts, val: bidN - askN });
      console.debug('[main ⇒ worker] cfdPoint', ts);

      // 1️⃣ keep the raw buffers bounded to CFD_CAP points
      addPoint(cfdSeries.bids, [ts, bidN]);
      addPoint(cfdSeries.asks, [ts, askN]);
      addPoint(cfdSeries.imb , [ts, bidN - askN]);
      addPoint(cfdSeries.mid , [ts, mid]);

      // 2️⃣ push *one* point into each visible Highcharts series
      const shift = obCFD.series[0].data.length >= CFD_CAP;   // drop oldest?
      obCFD.series[0].addPoint([ts, bidN],      false, shift);
      obCFD.series[1].addPoint([ts, askN],      false, shift);
      obCFD.series[2].addPoint([ts, bidN-askN], false, shift);
      obCFD.series[3].addPoint([ts, mid],       false, shift);

      // 3️⃣ throttle expensive redraws (here: once per second)
      if (!feedCFD.lastDraw || ts - feedCFD.lastDraw > 1000) {
        obCFD.redraw(false);
        feedCFD.lastDraw = ts;
      }
    }
    window.feedCFD = feedCFD;          // ← temporary debug hook

    // ──────────────────────────────────────────────────
    // 1) State & buffers
    // ──────────────────────────────────────────────────
    const sizeStats  = new RollingStats(600);   // ≈ 5‑10 min of prints on BTC
    const depthStats = new RollingStats(120);   // ≈ 2 min of 1‑second book snaps

    /* helper to protect against zeros until buffers warm up */
    // return the value if it’s a number, otherwise 0
    const SAFE = v => (Number.isFinite(v) ? v : 0);

    let lastAdaptive = 0;

    
    // Adaptive liquidity thresholds – will be filled in refreshAdaptive()
    let LIQ_THIN  = 0;
    let LIQ_THICK = 0;

    const momTimes = [];
    const MOM_WINDOW_MS = 2000;       // look back over 2 seconds     
    const UI_THROTTLE_MS  = 300;                // 4 Hz redraw cap

    /* ─── Re-usable JSON fetch with one quick retry ───────────────── */
    async function fetchJSON(url, opts = {}, retry = true) {
      const resp = await fetch(url, opts);
      if (resp.ok) return resp.json();

      /* first failure – maybe transient; wait 100 ms and retry once  */
      if (retry) {
        await new Promise(r => setTimeout(r, 100));
        return fetchJSON(url, opts, false);          // second try, no more retries
      }
      /* still not OK → propagate an Error the caller can catch       */
      throw new Error(`HTTP ${resp.status}`);
    }

        /* ───  tiny OBI colour helper  ───────────────────────────────────── */
    const OBI_EPS = 0.07;   // grey buffer around “balanced”
    function colourObi(ratio){
      const elNum = document.getElementById('obiRatio');
      const elTxt = document.getElementById('obiRatioTxt');
      if (!elNum || !elTxt) return;

      // clear previous state
      elNum.classList.remove('obi-bull','obi-bear','obi-flat');
      elTxt.classList.remove('obi-bull','obi-bear','obi-flat');

      const diff = ratio - 1;          // >0 ⇒ bid-heavy, <0 ⇒ ask-heavy
      let cls = 'obi-flat';
      if (diff >  OBI_EPS) cls = 'obi-bull';
      if (diff < -OBI_EPS) cls = 'obi-bear';

      elNum.classList.add(cls);
      elTxt.classList.add(cls);
    }

    function colourBias(val){
      const num = document.getElementById('biasRoll');
      const txt = document.getElementById('biasRollTxt');
      if (!num || !txt) return;
      num.classList.remove('obi-bull','obi-bear','obi-flat');
      txt.classList.remove('obi-bull','obi-bear','obi-flat');
      const cls = 'obi-' + classifyBias(val);
      num.classList.add(cls);
      txt.classList.add(cls);
    }
    /* helper – call whenever you need the current yard-stick           */
    function bigPrintThreshold () {
      // rolling 90-th percentile ≈ "normal big print"
      const p90 = sizeStats.pct(0.9) || 20_000;
      return 3 * p90;                          // “3× normal”
    }

    function refreshAdaptive () {
        const ds = depthStats.std();
        const depthStd = Number.isFinite(ds) ? ds : 1e6;

        if (Date.now() - lastAdaptive < 1000) return;
        lastAdaptive = Date.now();

        /* a) 90-th percentile of the last ~10 min is a nicer “big print” cut-off */
        const p90Size  = SAFE(sizeStats.pct(0.9), 20_000);   // fallback 20 k
        P.FALSE_ABS    = Math.max(25_000, p90Size);          // 90-pct, floor 25 k

        /* b) cooldown  =  1.2 × median inter-print interval */
        const printRate = sizeStats.buf.length / 300;        // prints per sec
        P.FALSE_NEUTRAL = Math.max(800, 1_200/Math.max(printRate, 0.2));  // ms

        /* rest unchanged … */
        // use the 90-th percentile of trade counts seen in the last 5-10 min
        P.MOM_COUNT_THRESH = Math.max(5, sizeStats.pct(0.90));
        P.FULL_SCALE_SLOPE = Math.max(1e5, 2 * depthStats.std());
        /* ── NEW: compute depth thresholds for Thin / Thick ── */

      const m   = depthStats.median();
      const medDepth = Number.isFinite(m) ? m : 50_000_000;
      LIQ_THIN  = medDepth - 0.5 * depthStd;
      LIQ_THICK = medDepth + 1.0 * depthStd;
  }

    function adaptiveThresholds () {
      // always refresh first so the numbers are current
      refreshAdaptive();
      return {
        FALSE_ABS: P.FALSE_ABS,
        FALSE_NEUT: P.FALSE_NEUTRAL / 1000,   // legacy wants seconds
        MOM_THRESH: P.MOM_COUNT_THRESH,
        SHOCK_SCALE: P.FULL_SCALE_SLOPE
      };
    }
    P.adaptiveThresholds = adaptiveThresholds;

    // ─── PARAMS & STATE ────────────────────────────────────────────────────
    

    /*  tiny helper reinstated  */
    function readParams () {
      P.WINDOW          = +$('obi-window').value;
      P.MIN_NOTIONAL    = +$('min-notional').value;
      P.DEPTH_PARAM     = +$('obi-depth').value;
      P.REFRESH_PERIOD  = +$('obi-period').value;

      P.VOL_WINDOW      = +$('obi-vollook').value;
      P.FALSE_ABS       = +$('obi-falseabs').value;
      P.FALSE_NEUTRAL   = +$('obi-falseneut').value * 1000; // s → ms
      P.MOM_COUNT_THRESH= +$('obi-momthresh').value;
      sendConfig();
    }

  // ----  NEW: spawn worker  -----------------------------------
 let  worker = new Worker('./metricsWorker.js', { type: 'module' });
 window.metricsWorker = worker;   // ← expose for debugging
/* -----------------------------------------------------------
 * (Re)-initialise the metrics Web-Worker
 * ----------------------------------------------------------- */
let workerGen = 0;
function ensureWorker () {
  if (worker && !worker.terminated) return;      // still alive – nothing to do

  // ①  (re)Create
  workerGen += 1;
  const thisGen = workerGen;
  worker = new Worker('./metricsWorker.js', { type: 'module' });
  window.metricsWorker = worker;   // ← expose for debugging

  // ----- DIAGNOSTIC PATCH: CFD Forecast Debugger -----
console.log('[CFD Forecast] Update called');
console.log('[CFD Forecast] obCFD:', obCFD);
if (!obCFD) {
  console.error('[CFD Forecast] obCFD is not initialized!');
} else {
  let sids = obCFD.series.map(s => s.id);
  console.log('[CFD Forecast] Series IDs:', sids);
  ['imb-fore', 'imb-up', 'imb-lo', 'imb-conf'].forEach(id => {
    let s = obCFD.get(id);
    if (!s) {
      console.error(`[CFD Forecast] Series "${id}" is missing!`);
    } else {
      console.log(`[CFD Forecast] Series "${id}" exists, length:`, s.data?.length);
    }
  });
}
console.log('[CFD Forecast] base:', base);
console.log('[CFD Forecast] up:', up);
console.log('[CFD Forecast] lo:', lo);
if (!(base && base.length && Array.isArray(base[0]) && base[0].length === 2)) {
  console.error('[CFD Forecast] base array is empty or malformed!', base);
}
if (!(up && up.length === base.length && lo && lo.length === base.length)) {
  console.error('[CFD Forecast] up/lo array lengths do not match base!', up, lo);
}
// -----------------------------------------------------

  // ②  Wire listeners *once*
  worker.addEventListener('message', ({ data }) => {
    if (thisGen !== workerGen) return;
      if (data.type === 'cfdForecast') {
        const { base, up, lo } = data.payload;
        if (!obCFD || obCFD.series.length < 7) {
            console.warn('CFD chart not ready for forecast lines!', obCFD);
          }
        console.log('CFD Chart series IDs:', obCFD.series.map(s => s.id));
        updateForecastSeries(base, up, lo);      // existing call
        
        metricsWorker.__lastFc = data.payload;   // (optional debug)
      }

    /* existing adaptive / gauges / anomaly routing  */
    if (data.type === 'adapt')   { /* … */ }
    if (data.type === 'gauges')  { /* … */ }
    if (data.type === 'anomaly') { /* … */ }
  });

  // ③  Push the full tunables object in **one** clean post
  sendConfig();         // <-- your existing helper stays unchanged
}



 // proxy: push tunables every time they change
 function sendConfig () {
   worker.postMessage({ type:'config', payload:{
     WINDOW:P.WINDOW, DEPTH_PARAM:P.DEPTH_PARAM,
     FALSE_ABS:P.FALSE_ABS, FALSE_NEUTRAL:P.FALSE_NEUTRAL,
     MOM_COUNT_THRESH:P.MOM_COUNT_THRESH, VOL_WINDOW:P.VOL_WINDOW
   }});
 }
 sendConfig();          // once at start




    ['DEPTH_BPS','VOL_WINDOW','FALSE_ABS'].forEach(k=>{
    if (!(k in P))
        console.warn(`Parameter ${k} is missing or typo-ed`);
    });  


    const S_HI          = 1.8,
          S_LO          = 0.55,
          S_STALE       = 5;

    let lastNeutral = Date.now(),
        lastHeavy   = 0,
        lastExtreme = {side:0,ts:0},
        lastSpread  = null,
        lastLaR     = 0.3; // ◀── TODO: replace with your realized-vol calculation

     if (!Number.isFinite(lastLaR)) lastLaR = 0;        

    // rolling buffers
    /*****************************************************************
      * 4.  Gauges, charts, buffers  (original logic, but use P.*)     *
      *****************************************************************/
      const buf = { c: [], w: [], s: [], f: [], r: [], shock: [], bias: [] };
      const pushBuf = (a, v, maxLen = P.WINDOW) => {
        a.push(v);
        if (a.length > maxLen) a.shift();
      };

      /* *** ADD THIS LINE *** */
      const priceBuf = [];              // stores { ts, mid } for realised-vol calc
      const biasCalc = new RollingBias(P.WINDOW);


    // donut counters
    let absCount = {buy:0,sell:0},
        cfCount  = {confirm:0,fake:0};

    // scenario flags (to fire once per crossing)
    const lastFired = {
      confirmation:false,
      squeeze:     false,
      fakeout:     false,
      earlywarn:   false
    };


    function pushTicker(msg){
      $('ticker-inner').textContent = msg;
    }

    // ──────────────────────────────────────────────────
    // 2) Realized‐vol helper
    // ──────────────────────────────────────────────────
    function calcRealizedVol(buf) {
      if (buf.length < 2) return 0;
      // log returns
      const logs = [];
      for (let i = 1; i < buf.length; i++) {
        logs.push(Math.log(buf[i].mid / buf[i-1].mid));
      }
      const mean = logs.reduce((a,b)=>a+b,0)/logs.length;
      const variance = logs.reduce((a,b)=>a+(b-mean)**2,0)/(logs.length-1);
      return Math.sqrt(variance);
    }    

    /*************************************************************************
* 1.  Shared helper – guarantees a finite number and clamps to 0-100
*************************************************************************/
const pct = v => Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));

/*************************************************************************
* 2.  A tiny factory that returns a nice-looking horizontal gauge
*************************************************************************/
function makeProgress(containerID, titleText) {
  return Highcharts.chart(containerID, {
    chart  : { type: 'bar', height: 80, spacing: [0, 10, 0, 10], backgroundColor: 'transparent' },
    title  : { text: `<b>${titleText}</b>`, align: 'center', y: 10, style: { fontSize: '15px', textTransform: 'uppercase' } },
    xAxis  : { visible: false },
    yAxis  : {
      min: 0, max: 100, tickInterval: 25, gridLineWidth: 0, title: null,
      plotBands: [{ from: 0, to: 100, color: '#e6e6e6' }],
      plotLines: [{ value: 75, width: 2, color: '#555', zIndex: 3 }]
    },
    legend : { enabled: false },
    tooltip: { enabled: false },
    plotOptions: {
      series: {
        pointWidth: 30,
        borderRadius: 7,
        dataLabels: {
          enabled: true,
          inside: true,
          align: 'left',
          style: { color: '#fff', fontSize: '22px', fontWeight: 900, textOutline: '2px solid #333' },
          formatter() { return `${Math.round(this.y)} %`; }
        }
      }
    },
    credits : { enabled: false },
    exporting: { enabled: false },
    series : [{
      data          : [0],
      color         : '#4dff88', // Will be overridden in runtime update
      showInLegend  : false
    }]
  });
}

// Takes a value 0-100 and returns the regime category as a string
function regimeName(pct) {
  const v = Number(pct);               // force numeric
  if (v >=   0 && v < 33) return "Mean Reversion";          // 0-32 %
  if (v >=  33 && v < 66) return "Pull-back Continuation";  // 33-65 %
  return "Break-out Continuation";                          // 66-100 %
}

function regimeDetails(value) {
  if (value < 33) 
    return {name: "Mean Reversion", desc:"Fade moves, play reversals"};
  if (value < 66)
    return {name: "Trend Pullback", desc:"Ride trends on dips/pullbacks"};
  return {name: "Breakout", desc:"Momentum & breakout trades"};
}

    // ─────────────────────────────────────────────────────────────────────
    // GAUGE FACTORY
    // ─────────────────────────────────────────────────────────────────────
    /* ─── Gauge help text ─────────────────────────────────────────────── */
    const GAUGE_INFO = {
      gConfirm : `<b>Confirmation</b><br>
                  Tracks net absorptions: &nbsp;
                  +1&nbsp;==&nbsp;strong buy absorption, -1&nbsp;==&nbsp;strong sell.<br>
                  > 0.10 → bullish confirmation, < -0.10 → bearish.`,
      gWarn    : `<b>Early-Warn</b><br>
                  Large absorption followed by exhaustion on the *same* side.<br>
                  Builds when a move runs out of steam and may reverse.`,
      gSqueeze : `<b>Squeeze</b><br>
                  Extremes of flow switching direction in < 5 s.<br>
                  High absolute values often precede violent stop-runs.`,
      gFake    : `<b>Fake-Out</b><br>
                  Oversized absorption OUTSIDE normal bias window.<br>
                  Spike → likely false break; fade the flow.`,
      gLaR     : `<b>Liquidity-at-Risk (5 min)</b><br>
                  Depth within ±10 bps ÷ realised-vol.<br>
                  0 → fragile book, 1 → very resilient.`,
      gRes     : `<b>Resilience</b><br>
                  60-s slope of total depth (bid – ask).<br>
                  Positive = bids being replenished faster.`,
      gShock   : `<b>Multi-Level Shock</b><br>
                  Sudden symmetric drop in deep book liquidity.<br>
                  Negative = bid shock, Positive = ask shock.`,
      gMom     : `<b>Momentum-Ignition</b><br>
                  # of aggressive prints in 2 s vs adaptive threshold.<br>
                  > 0 → expanding buying or selling frenzy.`
    };

    function makeGauge(id){
      return Highcharts.chart(id,{
        chart:{type:'solidgauge'},
        title:null,
        tooltip:{
          useHTML:true,
          borderWidth:0,
          backgroundColor:'rgba(255,255,255,0.92)',
          shadow:true,
          style:{fontSize:'12px',lineHeight:'16px'},
          formatter(){ return GAUGE_INFO[id] || '—'; }
        },
        pane:{
          center:['50%','60%'], size:'100%',
          startAngle:-105,endAngle:105,
          background:{innerRadius:'85%',outerRadius:'100%',shape:'arc',backgroundColor:'#eee'}
        },
        yAxis:{min:-1,max:1,
          stops:[[0,'#ff4d4d'],[0.5,'#999'],[1,'#4dff88']],
          lineWidth:0,tickWidth:0,labels:{enabled:false}
        },
        plotOptions:{solidgauge:{
          borderWidth:'12px',
          dataLabels:{enabled:true,useHTML:true,
            format:'<div style="text-align:center;">'+
                   '<span style="font-size:1.6em;color:{point.color}">'+
                   '{point.y:+.2f}</span></div>'
          }
        }},
        series:[{data:[0]}],
        credits:{enabled:false}
      });
    }

    /* 2⃣  A tiny helper so we never feed NaN into the chart */
    const N = v => (Number.isFinite(v = +v) ? v : 0);

    /* 3⃣  A common options object ---------------------------------------- */
    const barOpts = {
      chart   : { type: 'bar', inverted: true, spacing: [0, 10, 0, 10] },
      title   : { text: null },
      xAxis   : { visible: false },
      yAxis   : {
        min: 0, max: 100,
        tickInterval: 25,
        gridLineWidth: 0,
        plotLines: [{              // static “target” line
          value : 75,
          width : 2,
          color : '#222'
        }],
        title: null
      },
      tooltip : { enabled: false },
      plotOptions: {
        series: {
          color: '#222',            // bar colour
          borderWidth: 0,
          pointPadding: 0,
          groupPadding: 0
        }
      },
      credits : { enabled: false },
      exporting: { enabled: false },
      series : [{ data: [0] }]     // single bar, single value
    };

    /* 4⃣  Instantiate the two spectra ------------------------------------ */
    const bullMeter = Highcharts.chart(
      'bullMeter',
      Highcharts.merge(barOpts, {
        chart: { backgroundColor: 'transparent' },
        title: { text: '<b>Bull Spectrum</b>', align: 'center', y: 10 }
      })
    );

    const bearMeter = Highcharts.chart(
      'bearMeter',
      Highcharts.merge(barOpts, {
        chart: { backgroundColor: 'transparent' },
        title: { text: '<b>Bear Spectrum</b>', align: 'center', y: 10 }
      })
    );
    
    const gC = makeGauge('gConfirm'),
          gW = makeGauge('gWarn'),
          gS = makeGauge('gSqueeze'),
          gF = makeGauge('gFake'),
          gR = makeGauge('gRes'),
          gL = makeGauge('gLaR'),
          gShock = makeGauge('gShock'),
          gMom = makeGauge('gMom');

    const upd = (g,v)=>g.series[0].points[0].update(Math.max(-1,Math.min(1,v)));
    const updC= v=>upd(gC,v),
          updW= v=>upd(gW,v),
          updS= v=>upd(gS,v),
          updF= v=>upd(gF,v);

    
    const updR     = makeUpd(gR);                                 // no clamp
    const updShock = makeUpd(gShock, v => Math.max(-1, Math.min(1, v)));
    const updMom   = makeUpd(gMom,   v => Math.max(-1, Math.min(1, v)));



    // ──────────────────────────────────────────────────
    // 3) New LaR gauge
    // ──────────────────────────────────────────────────

     
    // 2) Keep your helper exactly the same:

    const updL = v => gL.series[0].points[0].update(Math.max(0, v));
  
  

    function setGaugeStatus(id,val){
      let st='flat';
      if (val >  0.1) st = 'bull';
      if (val < -0.1) st = 'bear';
      const e = $(id);
      e.textContent = st.charAt(0).toUpperCase() + st.slice(1);
      e.className  = `obi-gauge-status ${st}`;
    }

    // ─────────────────────────────────────────────────────────────────────
    // PIE CHARTS
    // ─────────────────────────────────────────────────────────────────────
    const absChart = Highcharts.chart('absBySide',{
      chart:{type:'pie',backgroundColor:'transparent'},
      title:{text:null},
      tooltip:{pointFormat:'{point.name}: <b>{point.y}</b>'},
      plotOptions:{pie:{
        innerSize:'60%',
        dataLabels:{enabled:true,format:'{point.name}: {point.y}'}
      }},
      series:[{name:'Absorptions',data:[
        {name:'Buy',y:0,color:'#4dff88'},
        {name:'Sell',y:0,color:'#ff4d4d'}
      ]}],
      credits:{enabled:false}
    });

    const cfChart = Highcharts.chart('confirmFake',{
      chart:{type:'pie',backgroundColor:'transparent'},
      title:{text:null},
      tooltip:{pointFormat:'{point.name}: <b>{point.y}</b>'},
      plotOptions:{pie:{
        innerSize:'60%',
        dataLabels:{enabled:true,format:'{point.name}: {point.y}'}
      }},
      series:[{name:'Flow',data:[
        {name:'Confirm',y:0,color:'#3399FF'},
        {name:'Fake-Out',y:0,color:'#FF9933'}
      ]}],
      credits:{enabled:false}
    });

    /* ────────────────────────────────────────────────
    * GRID – recent big flow events
    * ────────────────────────────────────────────────*/


    /* 1) tiny renderer – build column vectors & feed Grid.js */
    /* easy re-usable renderer so Grid-Lite gets fresh data every call  */



  const MAX_FLOW_ROWS = 300;
  let   flowData      = [];

  function _renderFlowGridSync () {
  const cols = {};
  
  ['side','notional','type','price','time','bias'].forEach(k=>{
    cols[k] = flowData.map(r=>r[k]);
  });
  Grid.grid('flowGrid',{
    dataTable:{ columns:cols },
    columnDefaults:{
      header:{ className:'hcg-center' },
      cells :{ className:'hcg-right' }
    },
    columns:[
      { id:'side', header:{format:'Side'},
        cells:{ className:'hcg-center bold' } },
      { id:'notional', header:{format:'Notional'},
        cells:{ format:'${value:,.0f}' } },
      { id:'type',  header:{format:'Type'} },
      { id:'price', header:{format:'Price'} },
      { id:'time',  header:{format:'Time'} },
      { id:'bias',
        header:{ format:'Bias&nbsp;<span title="Rolling net absorption (−1…+1)">ℹ️</span>' },
        cells :{
          className:'{#if (gt value 0)}bullish-color{else if (lt value 0)}bearish-color{/if}',
          format:'{value:.2f}'
        },
        width:65 }
    ],
    height :260,
    paging :{ enabled:true, pageLength:10 },
    sorting:true
  });
}
  let gridQueued = false;
  function renderFlowGrid () {
    if (gridQueued) return;          // already scheduled
    gridQueued = true;
    requestAnimationFrame(() => {
      _renderFlowGridSync();
      gridQueued = false;
    });
  }

function initCFDChart () {
  if (obCFD) return;             // already initialised
  obCFD = Highcharts.stockChart('obCfd', {
    chart : { height:320, spacing:[10,10,25,10] },
      title : { text:'Order-Book Imbalance CFD', style:{ fontSize:'15px' } },
      xAxis : { type:'datetime', labels : { format : '{value:%H:%M:%S}' } },
      yAxis : [{
          title:{ text:'Depth Notional ($)', style:{ fontWeight:600 } }
        },{ title:{ text:'Price' }, opposite:true, visible:false }],
      tooltip : { shared:true, xDateFormat:'%H:%M' },
      legend  : { enabled:false },

    // ** Enable the navigator **
    navigator: { enabled: true },

    // Optional: Show range selector buttons
    rangeSelector: {
      enabled: true,
      inputEnabled: false,
      buttons: [
        { type: 'minute', count: 1, text: '1m' },
        { type: 'minute', count: 5, text: '5m' },
        { type: 'all', text: 'All' }
      ],
      selected: 1 // Default to 5m view
    },      

      // ⬇⬇⬇  NOTICE the added 'id' for EVERY SERIES  ⬇⬇⬇
      series  : [
        { id: 'bids',       name:'Bids',      type:'area', data:[],
          color:'rgba(77,255,136,.55)',  fillOpacity:.6 },
        { id: 'asks',       name:'Asks',      type:'area', data:[],
          color:'rgba(255,77,77,.55)',   fillOpacity:.6 },
        { id: 'imb',        name:'Imbalance', type:'line', data:[],
          color:'#1e90ff',  lineWidth:1.6 },
        { id: 'mid',        name:'Mid-price', type:'line', data:[],
          color:'#555',     dashStyle:'Dash', yAxis:1 },

        // Forecast & bands, all WITH explicit id!
        { id:'imb-fore', name:'Forecast',
          type:'line', data:[], dashStyle:'Dash',
          color:'#1e90ff', lineWidth:1.5, enableMouseTracking:false },

        { id:'imb-up', type:'line', data:[], dashStyle:'Dot',
          color:'#ffcc00', lineWidth:1, enableMouseTracking:false },

        { id:'imb-lo', type:'line', data:[], dashStyle:'Dot',
          color:'#ffcc00', lineWidth:1, enableMouseTracking:false },

        { id:'imb-conf', type:'arearange', data:[], zIndex:0,
          color:'#1e90ff', fillOpacity:.08, lineWidth:0,
          enableMouseTracking:false }        
      ],
      credits : { enabled:false }
    });
  window.obCFD = obCFD;
}

/**
 * Replace the data of the three forecast lines and the confidence band
 * *without* creating new series every tick, then visually separate
 * live vs-forecast.
 *
 * @param {Array<[number, number]>} base – centre-line forecast
 * @param {Array<[number, number]>} up   – upper bound
 * @param {Array<[number, number]>} lo   – lower bound
 */
function updateForecastSeries(base, up, lo) {
  // 0️⃣ --- PATCH: Chart/Series Existence Check ---
  if (!obCFD) {
    console.warn('[CFD Forecast] Chart not initialized! Initializing now…');
    initCFDChart();
  }
  // Check for critical series IDs and auto-repair if missing
  ['imb-fore','imb-up','imb-lo','imb-conf'].forEach(id=>{
    if (!obCFD.get(id)) {
      console.warn(`[CFD Forecast] Series "${id}" missing—resetting chart!`);
      obCFD.destroy();
      obCFD = null;
      initCFDChart();
    }
  });

  // 1️⃣ Validate arguments
  if (!obCFD) return;  // still not ready after patch
  if (!base?.length) {                     // nothing to draw – clean up & exit
    obCFD.xAxis[0].removePlotLine('fcStart');
    obCFD.redraw(false);
    return;
  }

  /* 2️⃣ Series handles */
  const fore  = obCFD.get('imb-fore');      // dashed centre line
  const upper = obCFD.get('imb-up');        // dotted upper band
  const lower = obCFD.get('imb-lo');        // dotted lower band
  const band  = obCFD.get('imb-conf');      // translucent arearange
  const live  = obCFD.series[2];            // solid live imbalance line

  /* 3️⃣ Replace data */
  fore?.setData(base,  false);
  upper?.setData(up,   false);
  lower?.setData(lo,   false);

  if (band) {
    const bandData = up.map((u, i) => [u[0], lo[i][1], u[1]]);
    band.setData(bandData, false);
  }

  if (obCFD && obCFD.xAxis[0]) {
    const extremes = obCFD.xAxis[0].getExtremes();
    console.log('[CFD Forecast] xAxis extremes:', extremes, 'Forecast range:', base[0]?.[0], '-', base[base.length-1]?.[0]);
    if (base[base.length-1]?.[0] > extremes.max || base[0]?.[0] < extremes.min) {
      console.warn('[CFD Forecast] Forecast data outside of viewable range!');
    }
  }

  /* 4️⃣ Style tweaks for visibility */
  fore?.update({
    color            : '#ff1493',          // strong magenta
    dashStyle        : 'Dash',
    lineWidth        : 3,
    zIndex           : 20,                 // <<< lift it above the areas
    enableMouseTracking : false
  }, false);

  upper?.update({ zIndex : 19 }, false);
  lower?.update({ zIndex : 19 }, false);
  band?.update ({ zIndex : 18 }, false);    // still under the lines

  const cutOff = base[0][0];    // first forecast ts
  const xAx    = obCFD.xAxis[0];

  xAx.removePlotLine('fcStart');
  xAx.addPlotLine({
    id   : 'fcStart',
    value: cutOff,
    width: 2,
    color: '#666',
    dashStyle: 'Dash',
    zIndex: 5
  });

  const horizon  = base[base.length - 1][0];   // *last* forecast point
  ensureViewport(horizon);

  // Fade live line to the right of the cut-off
  live?.update({
    zoneAxis : 'x',
    zones    : [{
      value: cutOff,
      color: '#1e90ff'
    }, {
      color: 'rgba(30,144,255,0.25)'
    }]
  }, false);

  /* 5️⃣  One inexpensive repaint */
  obCFD.redraw(false);
}

/**
 * Ensure the x-axis always shows the entire forecast horizon.
 * Called once after every forecast refresh.
 * @param {number} fcEndTs – timestamp of the *last* forecast point
 */
function ensureViewport (fcEndTs) {
  const xAx = obCFD.xAxis[0];
  const { min, max } = xAx.getExtremes();

  // 1) protect against the very first call (when min == max)
  if (min === undefined || max === undefined || min === max) {
    xAx.setExtremes(fcEndTs - 60_000, fcEndTs, false, false); // 1-min window
    return;
  }

  // 2) only pan if we are not already showing >10 min
  const width = max - min;
  if (fcEndTs > max && width < 10 * 60 * 1e3)
    xAx.setExtremes(fcEndTs - width, fcEndTs, false, false);

  /* if the forecast end lies outside the current window → pan right */
}


  /* ──────────────────────────────────────────────────────────────
    Push one trade row into the rolling grid
    ----------------------------------------------------------------
    Expects ONE object shaped like:
    {
      side: 'buy' | 'sell',
      notional: 123456,
      type: 'absorption' | 'exhaustion' | ...,
      price: 104250,
      ts:    1701954632500,           // ms
      bias:  -0.17                    // ← rolling net-absorption
    }
    ────────────────────────────────────────────────────────────── */
  function addFlow (row) {

    // 1) canonicalise & push to the front
    flowData.unshift({
      side     : row.side === 'buy' ? 'BID' : 'ASK',
      notional : row.notional,
      type     : row.type,
      price    : row.price ? row.price.toFixed(0) : '—',
      time     : new Date(row.ts || Date.now())
                  .toLocaleTimeString('en-US', { hour12:false }),
      bias     : Number(row.bias)
    });

    // 2) keep the buffer bounded
    if (flowData.length > MAX_FLOW_ROWS) flowData.pop();

    // 3) redraw the grid
    renderFlowGrid();

  // OPTIONAL – keep the “Book Bias over Time” chart in sync with every big trade
  if (Number.isFinite(row.bias)) biasChart.pushBias(row.ts || Date.now(), row.bias);    
  }

    const biasChart = new BookBiasLine('#biasLine');

    worker.addEventListener('message', ({ data }) => {
      if (data.type === 'anomaly') {
        biasChart.addAnomalyPoint(data.payload);
      }
    });

    let vol1m = 0, vol8h = 0, buckets = [];
    onCandle(c => {
      /* existing rolling-volume logic */
      vol1m = +c.v;
      buckets.push(vol1m);
      if (buckets.length > 480) buckets.shift();   // 8 h of 1-min candles
      vol8h = buckets.reduce((s, v) => s + v, 0);

      /* NEW 24-h price buffer */
      {
        const now      = Date.now();
        const closePx  = +c.c;                 // 1-min candle close
        window.__priceBuf24h = window.__priceBuf24h || [];
        window.__priceBuf24h.push([now, closePx]);

        /* drop anything older than 24 h */
        while (window.__priceBuf24h.length &&
              now - window.__priceBuf24h[0][0] > 86_400_000)
          window.__priceBuf24h.shift();
      }

      updateGauge('volGauge', vol8h);
    });

    /* ─── Live price tile + ± 24 h chip ───────────────────────────── */
    onCtx(({ markPx, midPx, oraclePx }) => {
      /* 1️⃣  take whichever field arrives first */
      const px = Number(markPx ?? midPx ?? oraclePx);
      if (!Number.isFinite(px)) return;                 // still syncing

      /* 2️⃣  live price */
      setHtml('priceLive',
              '$' + px.toLocaleString(undefined, { maximumFractionDigits: 2 }));

      /* 3️⃣  ±Δ% vs. 24-h-ago close                                *
      *     (use in-memory 1-min candle buffer; fall back to       *
      *      price24hAgo only if you kept that global around)      */
      let pct = null;

      if (window.__priceBuf24h?.length) {
        const px24hAgo = window.__priceBuf24h[0][1];          // oldest entry
        if (Number.isFinite(px24hAgo)) pct = px / px24hAgo - 1;
      } else if (Number.isFinite(price24hAgo)) {
        pct = px / price24hAgo - 1;
      }

      if (pct !== null) {
        const el = document.getElementById('price24h');
        el.textContent = (pct >= 0 ? '+' : '') + (pct * 100).toFixed(2) + '%';
        el.style.color = pct >= 0 ? '#28c76f' : '#ff5252';     // green ↑, red ↓
      }
    });


    /* ===== widgets that can be slow-lane ===== */
/* ------------------------------------------------------------------
 * 30-second poll – open-interest, funding, 24 h volume, liquidity
 * ------------------------------------------------------------------ */
async function pullSlowStats () {
  try {
    const res  = await fetch('/api/slow-stats');
    const data = await res.json();

    /* The backend should send these fields – guard just in case       */
    // 30-day medians (needed for the red/green/grey strength dots)
    if (Number.isFinite(data.liq30dMedian)) LIQ_MEDIAN = data.liq30dMedian;
    if (Number.isFinite(data.vol30dMedian)) VOL_MEDIAN = data.vol30dMedian;

    /* A *snapshot* of current depth so the Liquidity dot has context. */
    // If your endpoint doesn’t include it, compute it locally instead.
    const liqSnap = Number.isFinite(data.liqSnap) ? data.liqSnap : NaN;

    updateBigTiles({
      oi         : data.oi,                  // raw open-interest (number)
      funding8h  : data.funding * 8 * 100,   // pct for the last 8 h leg
      vol24h     : data.vol24h,              // rolling 24 h volume
      liqSnap,                              // depth snapshot (can be NaN)
      ts         : data.ts                  // server timestamp
    });
  } catch (err) {
    console.warn('[slow-stats]', err);
  }
}

    
    /* ── simple renderer for the big metric tiles ───────────────── */
    /* The caller now provides depthSnap, medians too */
/* -------------------------------------------------------------
 *  Big metric tiles + four status-dots
 * ------------------------------------------------------------- */
function updateBigTiles({ oi, funding8h, vol24h, liqSnap = NaN, ts }) {
  /* ── tiny helpers ───────────────────────────────────────── */
  const $       = id => document.getElementById(id);
  const asNum   = v  => Number.isFinite(+v) ? +v : 0;
  const pctStr  = v  => `${v >= 0 ? '+' : ''}${v.toFixed(4)} %`;

  /* 1️⃣  OI + Funding status-dot -------------------------- */
  const deltaOi        = asNum(oi) - (window.__prevOi ?? asNum(oi));
  window.__prevOi      = asNum(oi);

  const oiState        = stateOiFunding({
    dOi     : deltaOi,
    funding : asNum(funding8h)
  });

  paintDot($('#dot-oi'), oiState,
    `OI ${deltaOi >= 0 ? '▲' : '▼'} ${Math.abs(deltaOi).toLocaleString()}  |  `
  + `Funding ${pctStr(asNum(funding8h))}`);

  /* 2️⃣  Liquidity & Volume dots ------------------------- */
  /*   – only colour-code once we have the 30-day medians   */
  if (Number.isFinite(LIQ_MEDIAN) && Number.isFinite(liqSnap)) {
    const pctLiq   = (liqSnap - LIQ_MEDIAN) / LIQ_MEDIAN;
    paintDot($('#dot-liq'),
      stateStrength({ pctVsMedian: pctLiq }),
      `Liquidity ${(pctLiq * 100).toFixed(1)} % vs 30-day median`);
  } else {
    paintDot($('#dot-liq'), 'normal', 'Liquidity — median pending');
  }

  if (Number.isFinite(VOL_MEDIAN)) {
    const pctVol   = (asNum(vol24h) - VOL_MEDIAN) / VOL_MEDIAN;
    paintDot($('#dot-vol'),
      stateStrength({ pctVsMedian: pctVol }),
      `Volume ${(pctVol * 100).toFixed(1)} % vs 30-day median`);
  } else {
    paintDot($('#dot-vol'), 'normal', 'Volume — median pending');
  }

/* 3️⃣  Numeric tiles (compact notation) ---------------- */
setTxt('card-oi',      formatCompact(asNum(oi)));
setTxt('card-funding', pctStr(asNum(funding8h)));
setTxt('card-vol24h',  formatCompact(asNum(vol24h)));

/* 4️⃣  Last-updated stamp ------------------------------ */
if (ts) setTxt('card-upd', new Date(asNum(ts)).toLocaleTimeString());


}



    pullSlowStats();
    setInterval(pullSlowStats, 30_000);            // every 30 s is plenty




// ─────────────────────────────────────────────────────────────────────
// STREAM START / STOP
// ─────────────────────────────────────────────────────────────────────
let obiSSE, flowSSE, running=false;
async function start () {
    P.startStreams       = start;
    if (running) return;
    readParams();
    ensureWorker();
    running = true;
    $('stream-btn').textContent = 'Stop Streams';

    /* tell server to spin up feed */
    fetch('/startFlow', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ coin: $('obi-coin').value })
    }).catch(console.warn);

  // OBI imbalance stream
  /* ── OBI stream ----------------------------------------------------- */
  obiSSE = new EventSource(`/api/obImbalanceLive?coin=${$('obi-coin').value}` +
                          `&depth=${P.DEPTH_PARAM}&period=${P.REFRESH_PERIOD}`);


obiSSE.onmessage = async (e) => {
  /* 0. Parse payload (skip heartbeats) */
  let d; try { d = JSON.parse(e.data); } catch { return; }

  worker.postMessage({ type:'depthSnap', payload:d });
  feedCFD(d); 
  
  /* 2. Re‑compute adaptive scalers and overwrite globals */
  const adapt = adaptiveThresholds();
  // globals declared elsewhere with "let" so we can mutate them:
  P.FALSE_ABS          = adapt.FALSE_ABS;
  P.FALSE_NEUTRAL      = adapt.FALSE_NEUT * 1000;   // store in ms
  P.MOM_COUNT_THRESH   = adapt.MOM_THRESH;
  P.FULL_SCALE_SLOPE   = adapt.SHOCK_SCALE;         // used in resilience & shock

  // grab symbol / depth once
  const symbol     = $('obi-coin').value.replace(/-PERP$/, '');
  const depthParam = P.DEPTH_PARAM;

/* 3.  Update KPIs – OBI ratio, liquidity */
const r = Number(d.ratio);
if (!Number.isFinite(r)) return;          // guard against NaN

setHtml('obiRatio', r.toFixed(2));        // 🔴  put the number back

// caption & colour
const cls  = classifyObi(r);              // returns 'bull' | 'bear' | 'flat'
const txt  = r > 1 + OBI_EPS ? 'Bid-Heavy'
           : r < 1 - OBI_EPS ? 'Ask-Heavy' : 'Balanced';

colourObi(r);                             // same helper as before
setHtml('obiRatioTxt', txt);


  const totalDepthSnap = d.bidDepth + d.askDepth;   // add this
  depthStats.push(totalDepthSnap);

  setHtml('liqVal', formatCompact(totalDepthSnap));

  
  /* ── NEW: 3-state classification ─────────────────────── */
  let liqState = 'Normal', colour = 'yellow';
  if (totalDepthSnap < LIQ_THIN)  { liqState = 'Thin';  colour = 'red';   }
  if (totalDepthSnap > LIQ_THICK) { liqState = 'Thick'; colour = 'green'; }

  setHtml('liqTxt', liqState);
  dot('liqDot', colour);

  /* 4.  Book Resilience – slope of depth change */
  if (!obiSSE._lastDepthTs) {
    obiSSE._lastDepth   = totalDepthSnap;
    obiSSE._lastDepthTs = d.ts;
  } else {
    const dt   = (d.ts - obiSSE._lastDepthTs) / 1000; // sec
    const prev = obiSSE._lastDepth;
    obiSSE._lastDepth   = totalDepthSnap;
    obiSSE._lastDepthTs = d.ts;

    const rawSlope  = dt ? (totalDepthSnap - prev) / dt : 0;
    const normSlope = Math.max(-1, Math.min(1, rawSlope / P.FULL_SCALE_SLOPE));

    buf.r.push(normSlope);
    if (buf.r.length > P.WINDOW) buf.r.shift();
    const avgR = buf.r.reduce((a, b) => a + b, 0) / buf.r.length;
    updR(avgR);
    setGaugeStatus('statusRes', avgR);
  }

  /* 5.  Spread & LaR (unchanged, uses dynamic FULL_SCALE_LAR) */
  try {
    // a) top‑of‑book spread
    const topResp = await fetch(`/books/${symbol}?depth=${depthParam}`);
    if (!topResp.ok) throw new Error(`HTTP ${topResp.status}`);
    const topBk  = await topResp.json();
    const bidPx  = +topBk.bids[0][0];
    const askPx  = +topBk.asks[0][0];
    const mid    = (bidPx + askPx) / 2;
    lastSpread   = (askPx - bidPx) / mid;

    // b) realised vol over last 5 min
    const now = Date.now();
    priceBuf.push({ ts: now, mid });
    while (priceBuf.length && now - priceBuf[0].ts > P.VOL_WINDOW) priceBuf.shift();
    const vol5m = calcRealizedVol(priceBuf);

    // c) deep book depth → raw LaR
    const deepResp = await fetch(`/books/${symbol}?depth=${depthParam * 2}`);
    if (!deepResp.ok) throw new Error(`HTTP ${deepResp.status}`);
    const deepBk = await deepResp.json();
    let depth10bps = 0;
    const lower = mid * (1 - P.DEPTH_BPS),
      upper = mid * (1 + P.DEPTH_BPS);
    deepBk.bids.forEach(([px, sz]) => { if (px >= lower) depth10bps += px * sz; });
    deepBk.asks.forEach(([px, sz]) => { if (px <= upper) depth10bps += px * sz; });

    const rawLaR = vol5m > 0 ? depth10bps / vol5m : 0;
    if (!Number.isFinite(rawLaR) || rawLaR < 0) rawLaR = 0;

    /* ------------------------------------------------------------
     * Robust yard-stick for the LaR gauge:
     * • hard floor  =  50 k
     * • volatility  =  3 × σ(depth)  (keeps pace with recent noise)
     * • liquidity   =  60 % of median book depth *
     *   (* falls back to 50 M when the median isn’t ready yet)
     * ---------------------------------------------------------- */
    const medDepth   = depthStats.median();
    const medSafe    = Number.isFinite(medDepth) ? medDepth : 50_000_000; // 50 M

    const FULL_SCALE_LAR = Math.max(
      50_000,                 // absolute floor
      3 * depthStats.std(),   // volatility term
      medSafe * 0.60          // 60 % of (robust) median depth
    );
    const scaledLaR      = Math.min(1, rawLaR / FULL_SCALE_LAR);
    lastLaR = scaledLaR;          // keep for spectrum composite
    updL(scaledLaR);              // drive the gauge
    setGaugeStatus('statusLaR', scaledLaR);


  } catch (err) {
    console.warn('Error computing LaR:', err);
    lastSpread = null;
    updL(0);
    setGaugeStatus('statusLaR', 0);
  }

  /* 6.  Multi‑Level Liquidity Shock (uses dynamic P.FULL_SCALE_SLOPE) */
  try {

    const deepBk2 = await fetchJSON(
      `/books/${symbol}?depth=${depthParam * 5}`
    );
    const totalBid = deepBk2.bids.reduce((s, [px, sz]) => s + px * sz, 0);
    const totalAsk = deepBk2.asks.reduce((s, [px, sz]) => s + px * sz, 0);

    if (!obiSSE._lastTotalBid) {
      obiSSE._lastTotalBid = totalBid;
      obiSSE._lastTotalAsk = totalAsk;
    } else {
      const bidDiff = (totalBid - obiSSE._lastTotalBid) / obiSSE._lastTotalBid;
      const askDiff = (totalAsk - obiSSE._lastTotalAsk) / obiSSE._lastTotalAsk;
      obiSSE._lastTotalBid = totalBid;
      obiSSE._lastTotalAsk = totalAsk;

      const shockRaw = (bidDiff - askDiff) /
                      (P.FULL_SCALE_SLOPE ? P.FULL_SCALE_SLOPE : 1);
      const shock    = Math.max(-1, Math.min(1, shockRaw));      
      buf.shock.push(shock);
      if (buf.shock.length > P.WINDOW) buf.shock.shift();

      const avgShock = buf.shock.reduce((a, b) => a + b, 0) / buf.shock.length;
      updShock(avgShock);
      setGaugeStatus('statusShock', avgShock);
    }
  } catch (err) {
    console.warn('Error computing shock:', err);
    updShock(0);
    setGaugeStatus('statusShock', 0);
  }
};
  obiSSE.onerror = ()=> setHtml('obiRatio','--');

  /*************************************************************************
  * 3.  Create the two gauges once  (replaces your old bullet code)
  *************************************************************************/
  const bullGauge = makeProgress('bullMeter', 'BULL SPECTRUM');
  const bearGauge = makeProgress('bearMeter', 'BEAR SPECTRUM');


 /* ---------------------------------------------------------------
 * FLOW stream – aggressive trades / absorptions / exhaustions
 * --------------------------------------------------------------- */
flowSSE = new EventSource(
  `/api/flowStream?coin=${$('obi-coin').value}`
);

flowSSE.onmessage = (e) => {
  /* ─── 0.  Parse & filter ───────────────────────────────────── */
  if (e.data.trim().endsWith('heartbeat')) return;

  let t;
  try { t = JSON.parse(e.data); } catch { return; }

  /* ─── 1.  Forward to the Web-Worker  (cheap, non-blocking) ─── */
  worker.postMessage({
    type    : 'trade',
    payload : { side: t.side, notional: t.notional, kind: t.type }
  });

  const now      = Date.now();
  const isAbs    = t.type === 'absorption';
  const isExh    = t.type === 'exhaustion';



  /* ─── 2.  Momentum-ignition counter *before* early-exit ────── */
  momTimes.push(now);
  while (momTimes.length && now - momTimes[0] > MOM_WINDOW_MS)
    momTimes.shift();

  /* ─── 3.  Early-exit for very small prints (UI still wants MOM) */
  if (t.notional < P.MIN_NOTIONAL) {
    const momVal = momTimes.length > P.MOM_COUNT_THRESH
      ? Math.min(1,
          (momTimes.length - P.MOM_COUNT_THRESH) / P.MOM_COUNT_THRESH)
      : 0;
    updMom(momVal);
    setGaugeStatus('statusMom', momVal);
    return;
  }

  /* ─── 4.  Rolling bias (abs + exh) ─────────────────────────── */
  if (isAbs || isExh) {
    biasCalc.push(t.type, t.side);
  }
  const biasVal = biasCalc.value();
  biasChart.pushBias(now, biasVal);

  const tooLarge  = (isAbs || isExh) && t.notional >= bigPrintThreshold();
  /* ─── 5.  Rolling scenario buffers (Confirm / Warn / …) ────── */

  /* 5-a) Absorptions ------------------------------------------ */
  if (isAbs) {
    pushBuf(buf.c, t.side === 'buy' ? 1 : -1);

    /* Fake-out flag – large absorption outside neutral window */
    const fake =
        t.notional >= P.FALSE_ABS &&
        now - lastNeutral >= P.FALSE_NEUTRAL
          ? (t.side === 'sell' ? 1 : -1)
          : 0;
    pushBuf(buf.f, fake, 15);

    if (t.notional >= P.FALSE_ABS && fake === 0)
      cfCount.confirm++;

    lastHeavy = t.notional >= P.FALSE_ABS;
    lastNeutral = now;

    if (t.iceberg && t.notional >= bigPrintThreshold())
      biasChart.addAnomalyPoint({
        ts   : t.ts || now,
        side : t.side,
        size : t.notional,
        kind : 'ice'
      });
  }

  /* 5-b) Exhaustions ------------------------------------------ */
  if (isExh) {
    let sq = 0;
    const age = (now - lastExtreme.ts) / 1000;
    if (age <= S_STALE && lastExtreme.side) {
      if ( lastExtreme.side ===  1 && t.side === 'sell') sq = -1;
      if ( lastExtreme.side === -1 && t.side === 'buy')  sq =  1;
    }
    lastExtreme = { side: t.side === 'buy' ? 1 : -1, ts: now };

    const warn = lastHeavy ? (t.side === 'sell' ? 1 : -1) : 0;
    pushBuf(buf.w, warn, 15);
    lastHeavy = false;                     // reset

    pushBuf(buf.s, sq, 15);

    if (sq && t.notional >= bigPrintThreshold())
      biasChart.addAnomalyPoint({
        ts   : t.ts || now,
        side : t.side,
        size : t.notional,
        kind : 'sq'
      });
  }

  /* ─── 6.  Momentum gauge (now that big prints counted) ─────── */
  const momVal = momTimes.length > P.MOM_COUNT_THRESH
    ? Math.min(1,
        (momTimes.length - P.MOM_COUNT_THRESH) / P.MOM_COUNT_THRESH)
    : 0;
  updMom(momVal);
  setGaugeStatus('statusMom', momVal);

  /* ─── 7.  Donut counters & ticker messages  ────────────────── */
  if (isAbs) absCount[t.side]++;

  if (isAbs && t.iceberg)
    pushTicker(`⛏️ Iceberg @ ${t.price.toFixed(0)} `
             + `($${(t.visibleDepth/1e3).toFixed(1)}k visible)`);

  /* ─── 8.  Throttle expensive UI updates to ~4 Hz ───────────── */
  /* ─── 8-a.  ALWAYS push the row to the rolling grid first ──── */
  addFlow({                          // new call
    ...t,                            // side / notional / type / price / ts
    bias: biasVal                    // ✔ correct rolling bias
  });

  /* ─── 8-b.  Now decide whether to do the heavy chart refresh ─ */
  if (now - (flowSSE.lastUpd || 0) < UI_THROTTLE_MS) return;
  flowSSE.lastUpd = now;

  /* ─── 9.  Scenario gauge scores  ───────────────────────────── */
  const c = fastAvg(buf.c),
        w = fastAvg(buf.w),
        s = fastAvg(buf.s),
        f = fastAvg(buf.f);

  updC(c); setGaugeStatus('statusConfirm',  c);
  updW(w); setGaugeStatus('statusWarn',     w);
  updS(s); setGaugeStatus('statusSqueeze',  s);
  updF(f); setGaugeStatus('statusFake',     f);

  

  /* ─── 10.  Bias-line point & line refresh  ─────────────────── */
  pushBuf(buf.bias, [now, biasVal]);
  setHtml('biasRoll',     biasVal.toFixed(2));
  setHtml('biasRollTxt',  biasVal > 0 ? 'Bullish'
                        : biasVal < 0 ? 'Bearish' : 'Flat');
  colourBias(biasVal);
  biasTimer.update(biasVal);
  

  /* ─── 11.  Bull / Bear composite meters  ───────────────────── */
  const raw = [
    SAFE(c), SAFE(w), SAFE(s), SAFE(f),
    SAFE(lastLaR), SAFE(fastAvg(buf.r)),
    SAFE(fastAvg(buf.shock)), SAFE(momVal)
  ];
  const W      = [1.4,1.2,1.0,1.0,0.7,0.7,0.8,0.6];
  const sumW   = W.reduce((a,b)=>a+b,0);
  const amplify= 1.5;

  const bullVal = pct(amplify *
        raw.reduce((s,v,i)=>s + Math.max(0,  v)*W[i], 0) / sumW * 100);
  const bearVal = pct(amplify *
        raw.reduce((s,v,i)=>s + Math.max(0, -v)*W[i], 0) / sumW * 100);

  bullGauge.series[0].points[0].update({
    y: bullVal,
    color: Highcharts.color('#4dff88').brighten(-bullVal/150).get()
  }, false);
  bearGauge.series[0].points[0].update({
    y: bearVal,
    color: Highcharts.color('#ff4d4d').brighten(-bearVal/150).get()
  }, true);

  const bullRegime = regimeName(Math.round(bullVal));
  const bearRegime = regimeName(Math.round(bearVal));
  $('bullRegime').textContent = `Strategy: ${bullRegime}`;
  $('bearRegime').textContent = `Strategy: ${bearRegime}`;
  $('bullRegime').title = regimeDetails(bullVal).desc;
  $('bearRegime').title = regimeDetails(bearVal).desc;

  /* ─── 12.  Donut charts & grid  ────────────────────────────── */
  absChart.series[0].setData([
    { name:'Buy',  y: absCount.buy,  color:'#4dff88' },
    { name:'Sell', y: absCount.sell, color:'#ff4d4d' }
  ], false);

  cfChart.series[0].setData([
    { name:'Confirm',  y: cfCount.confirm, color:'#3399FF' },
    { name:'Fake-Out', y: cfCount.fake,    color:'#FF9933' }
  ], false);

  absChart.redraw(false);
  cfChart.redraw(false);
};

}

function stop () {
    P.stopStreams        = stop;
    if (!running) return;
    running = false;
    $('stream-btn').textContent = 'Start Streams';
    obiSSE  && obiSSE.close();
    flowSSE && flowSSE.close();
  }


// ─────────────────────────────────────────────────────────────────────
// HOOK UP UI
// ─────────────────────────────────────────────────────────────────────

$('stream-btn').onclick = ()=> running ? stop() : start();
$('update-conn-btn').onclick = ()=>{
  readParams();
  if (running) {
    stop();
    setTimeout(start, 400); // wait 400ms before restarting
  }
};

$('obi-coin').addEventListener('change', async (e) => {
  const sym = e.target.value;             // "ETH-PERP", …
  stopPriceFeed();                        // close old socket
  startPriceFeed(sym);                    // open a new one
});

$('toggle-advanced').onclick = function(){
  const adv = $('advanced-settings'),
        open= adv.style.display!=='none';
  adv.style.display = open?'none':'block';
  this.textContent = '⚙ Advanced '+(open?'▾':'▴');
};
$('min-notional').onchange = e=> P.MIN_NOTIONAL=+e.target.value;
$('liqTxt').title = () =>
  `Thin  <  ${fmtUsd(LIQ_THIN)}\n` +
  `Normal between\n` +
  `Thick >  ${fmtUsd(LIQ_THICK)}`;

document.addEventListener('DOMContentLoaded', async () => {
  const firstSym = $('obi-coin').value;          // e.g. "BTC-PERP"
  initCFDChart();
  start();
  biasTimer.start();
  startPriceFeed('BTC');          // 👉 starts the live price stream
  try {
    const res = await fetch('/api/slow-stats');
    const data = await res.json();       // { oi, funding, vol24h, ts }
    updateBigTiles(data);                // <— use the object you just got
  } catch (err) {
    console.warn('[slow-stats]', err);
  }  
});


})();
