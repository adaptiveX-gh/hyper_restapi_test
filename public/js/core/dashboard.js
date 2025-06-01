
    import { onCtx, onCandle } from './perpDataFeed.js';
    import { BookBiasLine } from '../lib/bookBiasLine.js';

 
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
    
    let statsFeed = null;

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
    
    /* helper – call whenever you need the current yard-stick           */
    function bigPrintThreshold () {
      // rolling 90-th percentile ≈ "normal big print"
      const p90 = sizeStats.pct(0.9) || 20_000;
      return 3 * p90;                          // “3× normal”
    }

    function refreshAdaptive () {
        const depthStd = SAFE(depthStats.std(), 1e6);   // fallback 1 M USD if NaN

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
        const medDepth = SAFE(depthStats.median(), 5e7);   // fallback 50 M
        LIQ_THIN  = medDepth - 0.5 * depthStd;             // below ⇒ “Thin”
        LIQ_THICK = medDepth + 1.0 * depthStd;             // above ⇒ “Thick”

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
 const worker = new Worker('/js/worker/metricsWorker.js', { type: 'module' });

 // proxy: push tunables every time they change
 function sendConfig () {
   worker.postMessage({ type:'config', payload:{
     WINDOW:P.WINDOW, DEPTH_PARAM:P.DEPTH_PARAM,
     FALSE_ABS:P.FALSE_ABS, FALSE_NEUTRAL:P.FALSE_NEUTRAL,
     MOM_COUNT_THRESH:P.MOM_COUNT_THRESH, VOL_WINDOW:P.VOL_WINDOW
   }});
 }
 sendConfig();          // once at start

  worker.onmessage = ({ data }) => {
  if (data.type === 'adapt') {
    const a = data.payload;
    P.FALSE_ABS       = a.FALSE_ABS;
    P.FALSE_NEUTRAL   = a.FALSE_NEUT;
    P.MOM_COUNT_THRESH= a.MOM_THRESH;
    P.FULL_SCALE_SLOPE= a.FULL_SCALE_SLOPE;
  }
  if (data.type === 'gauges') {
    const g = data.payload;
    updC(g.confirm); setGaugeStatus('statusConfirm', g.confirm);
    updW(g.warn);    setGaugeStatus('statusWarn',    g.warn);
    updS(g.squeeze); setGaugeStatus('statusSqueeze', g.squeeze);
    updF(g.fake);    setGaugeStatus('statusFake',    g.fake);
  }

  if (data.type === 'anomaly') {
    const p   = data.payload;
    addAnomalyPoint({
      ts           : p.ts,
      side         : p.side,
      size         : p.size,
      isAbsorption : p.kind === 'abs'
    });
    refreshLine();             // redraw once per batch
  }

};


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



    // ──────────────────────────────────────────────────
    // 3) New LaR gauge
    // ──────────────────────────────────────────────────

     
    // 2) Keep your helper exactly the same:

    const updL = v => gL.series[0].points[0].update(Math.max(0, v));
  
    // helper to update Resilience
    function updR(v){ 
      gR.series[0].points[0].update(v); 
    }    
    function updShock(v){ 
     gShock.series[0].points[0].update(Math.max(-1, Math.min(1, v))); 
    }

    function updMom(v) {
      // clamp to [−1,1], though we’ll only use positives here
      gMom.series[0].points[0].update(Math.max(-1, Math.min(1, v)));
    }    

    function setGaugeStatus(id,val){
      let st='flat';
      if(val> 0.1) st='bull';
      if(val< -0.1)st='bear';
      const e=$(id);
      e.textContent = st.charAt(0).toUpperCase()+st.slice(1);
      e.className   ='obi-gauge-status '+st;
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
    const MAX_FLOW_ROWS = 300;      // keep the table snappy
    let   flowData      = [];

    /* 1) tiny renderer – build column vectors & feed Grid.js */
    function renderFlowGrid () {
      const cols = {};
      ['side','notional','type','price','time','bias'].forEach(k => {
        cols[k] = flowData.map(r => r[k]);
      });

      Grid.grid('flowGrid', {
        dataTable : { columns: cols },
        columnDefaults : {
          cells  : { className:'hcg-right' },
          header : { className:'hcg-center' }
        },
        columns : [
          { id:'side',     header:{ format:'Side'  },
            cells:{ className:'hcg-center bold' } },
          { id:'notional', header:{ format:'Notional' },
            cells:{ format:'${value:,.0f}' } },
          { id:'type',  header:{ format:'Type'  } },
          { id:'price', header:{ format:'Price' } },
          { id:'time',  header:{ format:'Time'  } },
          { id:'bias',
            header : { format:'Bias&nbsp;<span title="Rolling net absorption (−1…+1)">ℹ️</span>' },
            cells  : {
              className : '{#if (gt value 0)}bullish-color{else if (lt value 0)}bearish-color{/if}',
              format    : '{value:.2f}'
            },
            width : 65 }
        ],
        height  : 300,
        paging  : { enabled:true, pageLength:10 },
        sorting : true
      });
    }

      /* 2) push *one* new row and refresh table */
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
      bias     : Number.isFinite(row.bias) ? row.bias.toFixed(2) : '0.00'
    });

    // 2) keep the buffer bounded
    if (flowData.length > MAX_FLOW_ROWS) flowData.pop();

    // 3) redraw the grid
    renderFlowGrid();
  }

    const biasChart = new BookBiasLine('#biasLine');


    /* 2️⃣  wire the worker anomaly channel ---------------------- */
    worker.onmessage = ({ data }) => {
      if (data.type === 'anomaly') {
        biasChart.addAnomalyPoint(data.payload);
      }
    };

    let vol1m = 0, vol8h = 0, buckets = [];
    onCandle(c => {
        vol1m = +c.v;
        buckets.push(vol1m);
        if (buckets.length > 480) buckets.shift();   // keep 8 h of 1 m candles
        vol8h = buckets.reduce((s, v) => s + v, 0);
        updateGauge('volGauge', vol8h);
    });

    /* ===== widgets that can be slow-lane ===== */
    async function pullSlowStats () {
        const res = await fetch('/api/slow-stats');
        const { oi, funding, vol24h, ts } = await res.json();
        // maybe show a “last updated” time stamp
        updateBigTiles({ oi, funding8h: funding*8*100, vol24h, ts });
    }

    /* ── simple renderer for the big metric tiles ───────────────── */
    /* ── simple renderer for the big metric tiles ───────────────── */
    function updateBigTiles ({ oi, funding8h, vol24h, ts }) {
      const fmt = n =>
        Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

      const set = (sel, txt) => {
        const el = document.querySelector(sel);
        if (el) el.textContent = txt;
      };

      set('#card-oi',      fmt(oi));
      set('#card-funding',
          (funding8h >= 0 ? '+' : '') + fmt(funding8h) + '%');
      set('#card-vol24h',  '$' + fmt(vol24h));

      /* optional “last updated” stamp — add a <span id="card-upd"> in the HTML */
      set('#card-upd', new Date(ts).toLocaleTimeString());
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

const CFD_WINDOW_MS = 60*60*1000;
const cfdSeries = { bids:[], asks:[], imb:[], mid:[] };


obiSSE.onmessage = async (e) => {
  /* 0. Parse payload (skip heartbeats) */
  let d; try { d = JSON.parse(e.data); } catch { return; }
  worker.postMessage({ type:'depthSnap', payload:d });
  
    /* (A)  FEED CFD  — one-liner IIFE */
  (function feedCFD() {
    const ts = d.ts,
          bidN = d.bidDepth,
          askN = d.askDepth,
          mid = (d.topBid + d.topAsk) / 2;

    cfdSeries.bids.push([ts,bidN]);
    cfdSeries.asks.push([ts,askN]);
    cfdSeries.imb .push([ts,bidN-askN]);
    cfdSeries.mid .push([ts,mid]);

    const cut = ts - CFD_WINDOW_MS;
    Object.values(cfdSeries).forEach(arr=>{
      while (arr.length && arr[0][0] < cut) arr.shift();
    });

    const s = obCFD.series;
    s[0].setData(cfdSeries.bids,false);
    s[1].setData(cfdSeries.asks,false);
    s[2].setData(cfdSeries.imb ,false);
    s[3].setData(cfdSeries.mid ,false);
    if (!feedCFD.lastDraw || ts - feedCFD.lastDraw > UI_THROTTLE_MS){
      obCFD.redraw(false);
      feedCFD.lastDraw = ts;
    }
  })();

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
  const r = d.ratio;
  setHtml('obiRatio', r.toFixed(2));
  setHtml('obiRatioTxt', r >= 1.4 ? 'Bid‑Heavy' : r <= 0.6 ? 'Ask‑Heavy' : 'Balanced');

  const totalDepthSnap = d.bidDepth + d.askDepth;   // add this
  depthStats.push(totalDepthSnap);

  setHtml('liqVal', fmtUsd(totalDepthSnap));
  
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

    const FULL_SCALE_LAR = Math.max(
        50_000,                    // absolute floor
        3 * depthStats.std(),      // softer scale
        SAFE(depthStats.median(),5e7) * 0.6   // 60 % of median depth
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

  /* ─── 4.  Big-print anomaly check (3× recent 90-pct) ───────── */
  const biasVal   = fastAvg(buf.c.concat(buf.w).slice(-P.WINDOW));
  biasChart.pushBias(now, biasVal);

  const tooLarge  = (isAbs || isExh) && t.notional >= bigPrintThreshold();
  if (tooLarge) {
    biasChart.addAnomalyPoint({
      ts   : t.ts || now,
      side : t.side,
      size : t.notional,
      kind : isAbs ? 'abs' : 'exh'
    });
  }
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
  }

  /* 5-b) Exhaustions ------------------------------------------ */
  if (isExh) {
    lastExtreme = { side: t.side === 'buy' ? 1 : -1, ts: now };

    const warn = lastHeavy ? (t.side === 'sell' ? 1 : -1) : 0;
    pushBuf(buf.w, warn, 15);
    lastHeavy = false;                     // reset

    /* Squeeze – flow flips within 5 s                             */
    let sq = 0;
    const age = (now - lastExtreme.ts) / 1000;
    if (age <= S_STALE && lastExtreme.side) {
      if ( lastExtreme.side ===  1 && t.side === 'sell') sq = -1;
      if ( lastExtreme.side === -1 && t.side === 'buy')  sq =  1;
    }
    pushBuf(buf.s, sq, 15);
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


const obCFD = Highcharts.chart('obCfd', {
  chart : { type:'area', height:220, spacing:[10,10,25,10], zoomType:'x' },
  title : { text:'Order-Book Imbalance CFD', style:{ fontSize:'15px' } },
  xAxis : { type:'datetime' },
  yAxis : [{
      title:{ text:'Depth Notional ($)', style:{ fontWeight:600 } }
    },{
      title:{ text:'Price' }, opposite:true, visible:false
  }],
  tooltip : { shared:true, xDateFormat:'%H:%M' },
  legend  : { enabled:false },

  /*  ← ADD THESE FOUR PLACE-HOLDER SERIES  */
  series  : [
    { name:'Bids',       type:'area', data:[],
      color:'rgba(77,255,136,.55)',  fillOpacity:.6 },
    { name:'Asks',       type:'area', data:[],
      color:'rgba(255,77,77,.55)',   fillOpacity:.6 },
    { name:'Imbalance',  type:'line', data:[],
      color:'#1e90ff',   lineWidth:1.6 },
    { name:'Mid-price',  type:'line', data:[],
      color:'#555',      dashStyle:'Dash', yAxis:1 }
  ],

  credits : { enabled:false }
});


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

document.addEventListener('DOMContentLoaded', () => {
  start();                      // <— kicks off both SSE streams
});

})();
