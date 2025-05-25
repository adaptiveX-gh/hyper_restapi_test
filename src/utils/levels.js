// ────────────────────────────────────────────────────────────────────────────
//  Support / Resistance Level Extractor  –  resilient version
// ────────────────────────────────────────────────────────────────────────────

const axios            = require('axios');
const { Hyperliquid }  = require('hyperliquid');
const DBSCAN           = require('density-clustering').DBSCAN;

const sdk = new Hyperliquid(
  process.env.HL_PRIVATE_KEY || '',
  false,
  process.env.HL_API_WALLET  || ''
);

// ─── helpers ───────────────────────────────────────────────────────────────
const norm = s => s.replace(/-PERP$/i,'').toUpperCase();
const TF_MS = { m:60_000, h:3_600_000, d:86_400_000 };
function parseLookback(s='4h'){
  const [,n,u] = s.match(/^(\d+)([mhd])$/i) || [];
  const ms     = (n && TF_MS[u]) ? +n*TF_MS[u] : 4*TF_MS.h;
  return { candles: Math.round(ms/30_000), ms };
}

// ─── universal candle fetch (SDK → /info → trades-to-candles) ─────────────
async function fetchCandles(mkt, limit=480){
  // 1️⃣  SDK helper
  if (sdk.info?.candles){
    try{
      return await sdk.info.candles({ market:mkt, intervalSec:'30s', limit });
    }catch{/* ignore */}
  }

  // 2️⃣  /info RPC (public, unsigned)
  try{
    const body = { type:'candles', market:mkt, intervalSec:'30s', limit };
    const { data } = await axios.post('https://api.hyperliquid.xyz/info', body);
    if (Array.isArray(data) && data.length) return data;
  }catch{/* ignore */}

  // 3️⃣  Fallback: build candles from last 2 000 trades
  const tradesURL = `https://api.hyperliquid.xyz/trades?market=${encodeURIComponent(mkt)}&limit=2000`;
  const { data: trades } = await axios.get(tradesURL).catch(()=>({data:[]}));

  if (!Array.isArray(trades) || !trades.length) return [];

  // bucket trades into 30-s bins (close price only)
  const byBin = new Map();                      // tsFloor → price
  for (const t of trades){
    const ts = t.timestamp ?? t.time ?? 0;      // ms epoch
    const bin= Math.floor(ts/30_000)*30_000;
    byBin.set(bin, +t.px);                      // last trade in bin = close
  }
  const bins = Array.from(byBin.keys()).sort((a,b)=>a-b).slice(-limit);
  return bins.map(b => [b,null,null,null,byBin.get(b),null]);  // [t,?,?,?,c,?]
}

// ─── extrema detector ─────────────────────────────────────────────────────
function detectExtrema(candles){
  const hi=[], lo=[];
  const cOf = c => +c[4];
  for(let i=1;i<candles.length-1;i++){
    const a=cOf(candles[i-1]), b=cOf(candles[i]), c=cOf(candles[i+1]);
    if(b>a && b>c) hi.push({px:b,idx:i});
    if(b<a && b<c) lo.push({px:b,idx:i});
  }
  return hi.concat(lo);
}

// ─── cluster with DBSCAN ──────────────────────────────────────────────────
function clusterLevels(points){
  const eps   = +process.env.LEVELS_EPS       || 5;
  const minPt = +process.env.LEVELS_MIN_TOUCH || 3;
  if(!points.length) return [];

  const db = new DBSCAN();
  const cls= db.run(points.map(p=>[p.px]), eps, minPt, (a,b)=>Math.abs(a[0]-b[0]));

  return cls.map(ids=>{
          const pts = ids.map(i=>points[i]);
          const pxs = pts.map(p=>p.px).sort((a,b)=>a-b);
          const last= pts.reduce((m,p)=>p.idx>m.idx?p:m);
          return {
            px        : +pxs[Math.floor(pxs.length/2)].toFixed(2),
            touches   : pts.length,
            ageMinutes: Math.round((points.length-last.idx)*0.5)
          };
        })
        .sort((a,b)=>b.touches-a.touches || a.ageMinutes-b.ageMinutes)
        .slice(0,15);
}

// ─── public entrypoint ────────────────────────────────────────────────────
async function getLevels(rawCoin, lookback='4h'){
  const coin           = norm(rawCoin);
  const { candles:n }  = parseLookback(lookback);
  const candles        = await fetchCandles(`${coin}-PERP`, n);

  const extrema  = detectExtrema(candles);
  const clusters = clusterLevels(extrema);

  // debug counters
  console.log('[levels] candles ', candles.length,
              ' extrema ', extrema.length,
              ' clusters ', clusters.length);

  return clusters;
}

module.exports = { getLevels };
