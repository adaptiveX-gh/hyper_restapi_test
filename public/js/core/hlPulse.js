/*───────────────────────────────────────────────────*
 *  hlPulse.js  – “market-pulse” helper for Hyperliquid
 *  Exposes a single   startPulse( coin, onUpdate, cfg )
 *  that feeds you a once-per-second object:
 *      { volSpike, oiSpike, depthThin, funding }
 *  – volSpike : true  ↔  1-min vol > N× rolling median
 *  – oiSpike  : true  ↔  ΔOI(1-min) > $cfg.oiSpikeUsd
 *  – depthThin: true  ↔  depth@±10 bps < cfg.depthPctRef
 *  – funding  : next funding rate (number, %)
 *───────────────────────────────────────────────────*/
export function startPulse (coin, onUpdate, cfg = {}) {
  const VOL_MED_WIN   = cfg.volMedianWindow || 1440;     // 24 h of 1-min bars
  const VOL_SPIKE_MULT = cfg.volSpikeMult   || 3;        // 3× median → spike
  const OI_SPIKE_USD   = cfg.oiSpikeUsd     || 25e6;     // $25 M ΔOI
  const DEPTH_PCT_REF  = cfg.depthPctRef    || 0.40;     // <40 % of 24 h median
  const DEPTH_LEVELS   = cfg.depthLevels    || 10;       // top-10 levels

  // rolling buffers
  let volBuf = [];            // [{ts,vol}] last 1-min bars
  let depthBuf = [];          // keep med depth for ref
  let prevOi = 0, nextFunding = 0;

  /* ---------- WebSocket stream ---------- */
  const ws = new WebSocket('wss://api.hyperliquid.xyz/ws');

  ws.onopen = () => {
    ws.send(JSON.stringify({t:'subscribe', ch:'perpAggTrades', coin}));
    ws.send(JSON.stringify({t:'subscribe', ch:'clearingHouseState', coin}));
    ws.send(JSON.stringify({t:'subscribe', ch:'l2Book', coin, depth:DEPTH_LEVELS}));
    ws.send(JSON.stringify({t:'subscribe', ch:'perpFunding', coin}));
  };

  ws.onmessage = ({data}) => {
    const m = JSON.parse(data);

    /* 1 ░ volume ------------------------------------ */
    if (m.ch === 'perpAggTrades') {
      const v = m.d.reduce((s,t)=>s + t.sz, 0);               // sum size
      const barTs = Math.floor(Date.now()/60000);
      if (!volBuf.length || volBuf[0].ts !== barTs) volBuf.unshift({ts:barTs,vol:0});
      volBuf[0].vol += v;
      if (volBuf.length > VOL_MED_WIN) volBuf.pop();
    }

    /* 2 ░ open-interest ------------------------------ */
    if (m.ch === 'clearingHouseState') {
      const oi = m.d.perpOi;                       // USD notionals
      m.d && (prevOi = prevOi || oi);              // init once
      m.oiJump = Math.abs(oi - prevOi);            // 1-update ΔOI
      prevOi = oi;
    }

    /* 3 ░ depth -------------------------------------- */
    if (m.ch === 'l2Book') {
      const bids = m.d.bids.reduce((s,[,q])=>s+q,0);
      const asks = m.d.asks.reduce((s,[,q])=>s+q,0);
      const totDepth = bids + asks;
      depthBuf.push(totDepth);
      if (depthBuf.length > VOL_MED_WIN) depthBuf.shift();
    }

    /* 4 ░ funding ------------------------------------ */
    if (m.ch === 'perpFunding') {
      nextFunding = m.d.nextFundingRate;           // already %
    }
  };

  /* ---------- emit once per sec ---------- */
  const timer = setInterval(() => {
    /* guard – need a bit of data first */
    if (volBuf.length < 10 || depthBuf.length < 10) return;

    /* median helpers */
    const med = arr => [...arr].sort((a,b)=>a-b)[Math.floor(arr.length/2)];

    const volMed = med(volBuf.map(r=>r.vol));
    const latestVol = volBuf[0].vol;
    const volSpike = latestVol > volMed * VOL_SPIKE_MULT;

    const oiSpike = (prevOi && 'oiJump' in ws) ? ws.oiJump > OI_SPIKE_USD : false;

    const depthMed = med(depthBuf);
    const latestDepth = depthBuf[depthBuf.length-1];
    const depthThin = latestDepth < depthMed * DEPTH_PCT_REF;

    onUpdate({ volSpike, oiSpike, depthThin, funding: nextFunding });

  }, 1000);

  /* return stop-fn for cleanup */
  return () => { clearInterval(timer);  ws.close(); };
}
