require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const axios   = require('axios');
const pLimit = require('p-limit');
const limit = pLimit(5);

// Google Sheets helper
const { fetchTraderAddresses } = require('./sheetHelper');
// Hyperliquid SDK
const { Hyperliquid } = require('hyperliquid');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// instantiate SDK
const sdk = new Hyperliquid(
  process.env.HL_PRIVATE_KEY || '',
  false,
  process.env.HL_API_WALLET || ''
);

// -- Position-Delta Pulse Logic (Non-Stream) --------------------------------
async function positionDeltaPulse(addresses = [], minutes = 10, params = {}) {
  const { trimUsd = 0, addUsd = 0, newUsd = 0, maxHits = Infinity } = params;
  const now = Date.now();
  const startMs = now - minutes * 60_000;
  let hits = 0;
  const results = [];
  const processingDetails = [];

  for (const wallet of addresses) {
    if (hits >= maxHits) break;
    const fills = await sdk.info.getUserFillsByTime(wallet, startMs, now).catch(() => []);
    const stateRes = await sdk.info.perpetuals.getClearinghouseState(wallet).catch(() => ({}));
    const positions = stateRes.assetPositions || [];

    const openNow = {};
    for (const p of positions) {
      const sz = Number(p.position.szi);
      if (!sz) continue;
      openNow[p.position.coin] = {
        side: sz > 0 ? 'long' : 'short',
        sizeUsd: Math.abs(sz) * Number(p.position.entryPx),
        entry: Number(p.position.entryPx),
        liqPx: Number(p.position.liquidationPx)
      };
    }

    const opened = {}, closed = {};
    for (const f of fills) {
      const val = Math.abs(Number(f.sz)) * Number(f.px);
      if (f.dir.startsWith('Open')) opened[f.coin] = (opened[f.coin] || 0) + val;
      if (f.dir.startsWith('Close')) closed[f.coin] = (closed[f.coin] || 0) + val;
    }

    const coins = new Set([...Object.keys(opened), ...Object.keys(closed)]);
    for (const coin of coins) {
      if (hits >= maxHits) break;
      const oUsd = opened[coin] || 0;
      const cUsd = closed[coin] || 0;
      const st = openNow[coin];

      const reduced = (st && st.side === 'long' && cUsd >= trimUsd)
                    || (st && st.side === 'short' && cUsd >= trimUsd)
                    || (!st && cUsd >= trimUsd);
      const added = st && ((st.side === 'long' && oUsd >= addUsd) || (st.side === 'short' && oUsd >= addUsd));
      const openedFresh = !st && oUsd >= newUsd;

      processingDetails.push({
        wallet,
        coin: `${coin}-PERP`,
        openedUsd: +oUsd.toFixed(2),
        closedUsd: +cUsd.toFixed(2),
        reduced,
        added,
        openedFresh
      });

      if (reduced || added || openedFresh) {
        results.push({
          wallet,
          coin: `${coin}-PERP`,
          action: reduced ? 'reduced' : added ? 'added' : 'opened',
          side: st?.side || (oUsd > cUsd ? 'long' : 'short'),
          sizeUsd: st ? +st.sizeUsd.toFixed(2) : 0,
          avgEntry: st ? +st.entry.toFixed(2) : null,
          liqPx: st ? +st.liqPx.toFixed(2) : null
        });
        hits++;
      }
    }
  }

  return { results: results.length ? results : [{ result: 'no-setup' }], processingDetails };
}

// -- Position-Delta Pulse Non-Stream Endpoint -----------------------------
app.post('/api/positionDeltaPulse', async (req, res) => {
  const { minutes, params, addresses, filters } = req.body;
  try {
    const addrs = Array.isArray(addresses) && addresses.length
      ? addresses
      : await fetchTraderAddresses(filters || {});
    console.log(`→ positionDeltaPulse on ${addrs.length} addresses`);
    const data = await positionDeltaPulse(addrs, minutes || 10, params || {});
    res.json(data);
  } catch (err) {
    console.error('Error positionDeltaPulse:', err);
    res.status(500).json({ error: err.message });
  }
});

// -- Position-Delta Pulse Streaming Endpoint ------------------------------
app.post('/api/positionDeltaPulseStream', async (req, res) => {
  const { minutes, params, addresses, filters } = req.body;
  let addrs;
  try {
    addrs = Array.isArray(addresses) && addresses.length
      ? addresses
      : await fetchTraderAddresses(filters || {});
  } catch (err) {
    console.error('Error fetching addresses:', err);
    return res.status(500).json({ error: err.message });
  }

  console.log(`→ Streaming positionDeltaPulse on ${addrs.length} addresses`);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const now      = Date.now();
  const startMs  = now - (minutes || 10) * 60_000;
  const maxHits  = params?.maxHits ?? Infinity;
  const finalHits = [];                     // NEW
  let hits = 0;

  for (const wallet of addrs) {
    if (hits >= (params?.maxHits ?? Infinity)) break;
    res.write(JSON.stringify({ type:'log', wallet, stage:'starting scan' })+'\n');

    const fills = await sdk.info.getUserFillsByTime(wallet, startMs, now).catch(() => []);
    res.write(JSON.stringify({ type:'log', wallet, stage:'fetched fills', count:fills.length })+'\n');

    const stateRes = await sdk.info.perpetuals.getClearinghouseState(wallet).catch(() => ({}));
    const positions = stateRes.assetPositions || [];
    res.write(JSON.stringify({ type:'log', wallet, stage:'fetched positions', count:positions.length })+'\n');

    const openNow = {};
    for (const p of positions) {
      const sz = Number(p.position.szi);
      if (!sz) continue;
      openNow[p.position.coin] = {
        side: sz > 0 ? 'long' : 'short',
        sizeUsd: Math.abs(sz) * Number(p.position.entryPx),
        entry: Number(p.position.entryPx),
        liqPx: Number(p.position.liquidationPx)
      };
    }

    const opened = {}, closed = {};
    for (const f of fills) {
      const val = Math.abs(Number(f.sz)) * Number(f.px);
      if (f.dir.startsWith('Open')) opened[f.coin] = (opened[f.coin] || 0) + val;
      if (f.dir.startsWith('Close')) closed[f.coin] = (closed[f.coin] || 0) + val;
    }

    const coins = new Set([...Object.keys(opened), ...Object.keys(closed)]);
    for (const coin of coins) {
      if (hits >= (params?.maxHits ?? Infinity)) break;
      const oUsd = opened[coin] || 0;
      const cUsd = closed[coin] || 0;
      const st = openNow[coin];

      const reduced = (st && st.side === 'long' && cUsd >= params.trimUsd) ||
                      (st && st.side === 'short' && cUsd >= params.trimUsd) ||
                      (!st && cUsd >= params.trimUsd);
      const added = st && ((st.side === 'long' && oUsd >= params.addUsd) ||
                           (st.side === 'short' && oUsd >= params.addUsd));
      const openedFresh = !st && oUsd >= params.newUsd;

      res.write(JSON.stringify({ type:'log', wallet, coin:`${coin}-PERP`, stage:'evaluated',openedUsd:+oUsd.toFixed(2), closedUsd:+cUsd.toFixed(2),reduced, added, openedFresh })+'\n');

      if (reduced || added || openedFresh) {
      const entry = {
        type     : 'result',         // <-- NEW!
        wallet,
        coin     : `${coin}-PERP`,
        action   : reduced ? 'reduced' : added ? 'added' : 'opened',
        side     : st?.side || (oUsd > cUsd ? 'long' : 'short'),
        sizeUsd  : st ? +st.sizeUsd.toFixed(2) : 0,
          avgEntry : st ? +st.entry.toFixed(2) : null,
        liqPx    : st ? +st.liqPx.toFixed(2) : null
        };
        res.write(JSON.stringify(entry) + '\n');
        finalHits.push(entry);         // <-- save for the summary
        hits++;
      }
    }
  }
  res.write(JSON.stringify({ type: 'summary', results: finalHits }) + '\n');
  res.end();
});

// -- Aggressive Fills Endpoint --------------------------------------------
async function aggressiveFills({ addresses = [], minutes = 5, params = {} }) {
  const { minNotional = 100000 } = params;
  const now = Date.now();
  const start = now - minutes * 60_000;

  // throttle to 5 concurrent calls
  const fillsByWallet = await Promise.all(
    addresses.map(addr =>
      limit(() =>
        sdk.info.getUserFillsByTime(addr, start, now).catch(() => [])
      )
    )
  );

  // 2️⃣ Filter “aggressive” market orders above threshold
  const hits = [];
  for (let i = 0; i < addresses.length; i++) {
    const wallet = addresses[i];
    for (const f of fillsByWallet[i]) {
      const usd = Math.abs(Number(f.sz)) * Number(f.px);
      if (usd >= minNotional) {
        hits.push({
          wallet,
          coin: `${f.coin}-PERP`,
          side: f.dir.includes('Long') ? 'buy' : 'sell',
          sizeUsd: +usd.toFixed(2),
          price: +Number(f.px).toFixed(2),
          timestamp: f.time
        });
      }
    }
  }

  return hits.length ? hits : { result: 'no-aggressive-fills' };
}

// … up near the top, after you define `async function aggressiveFills(...)`
app.post('/api/aggressiveFills', async (req, res) => {
  const { addresses = [], minutes = 5, params = {} } = req.body;
  try {
    // if you load from sheet when blank:
    const addrs = Array.isArray(addresses) && addresses.length
      ? addresses
      : await fetchTraderAddresses(req.body.filters || {});
    
    console.log(`→ aggressiveFills on ${addrs.length} addresses, ${minutes}m, params=`, params);
    const data = await aggressiveFills({ addresses: addrs, minutes, params });
    res.json(data);
  } catch (err) {
    console.error('Error in aggressiveFills:', err);
    res.status(500).json({ error: err.message });
  }
});


// helper to fetch L2 book snapshot
async function getL2Book(coin) {
  // most recent SDK calls expose something like:
  if (sdk.info.orderbook?.getL2Book) {
    return await sdk.info.orderbook.getL2Book({ market: coin, depth: 50 });
  }
  // fallback to REST
  const res = await axios.get(`https://api.hyperliquid.xyz/l2Book?market=${encodeURIComponent(coin)}&limit=50`);
  return res.data;
}

// 1) Simplify the signature: no more addresses
async function volumeAbsorption({ coin, minutes = 5, surgeFactor = 2 }) {
  if (!coin) throw new Error("`coin` param is required");

  const now   = Date.now();
  const start = now - minutes * 60_000;

  // grab two L2 snapshots at start & now
  const [book0, book1] = await Promise.all([
    sdk.info.l2Book({ market: coin, ts: start }),
    sdk.info.l2Book({ market: coin, ts: now })
  ]);

  // diff depth eaten
  let bidEaten = 0, askEaten = 0;
  for (const [px, sz0] of book0.bids) {
    const sz1 = (book1.bids.find(b => b[0] === px)?.[1]) || 0;
    if (sz1 < sz0) bidEaten += sz0 - sz1;
  }
  for (const [px, sz0] of book0.asks) {
    const sz1 = (book1.asks.find(a => a[0] === px)?.[1]) || 0;
    if (sz1 < sz0) askEaten += sz0 - sz1;
  }

  // fetch aggregate trades over window
  const trades = await sdk.info.trades({ market: coin, startTime: start, endTime: now, aggregateByTime: false });
  const totalVol = trades.reduce((sum, t) => sum + Math.abs(Number(t.sz)), 0);

  const surgeDetected = (bidEaten + askEaten) > totalVol * surgeFactor;
  return { coin, lookbackMinutes: minutes, depthDiff: { bidEaten, askEaten }, totalVol, surgeDetected };
}

// 2) Wire up the endpoint
app.post('/api/volumeAbsorption', async (req, res) => {
  const {
    coin,
    minutes = 5,
    params: { surgeFactor = 2 } = {}
  } = req.body;

  try {
    const out = await volumeAbsorption({ coin, minutes, surgeFactor });
    res.json(out);
  } catch (err) {
    console.error("Error in volumeAbsorption:", err);
    res.status(500).json({ error: err.message });
  }
});


// -- Coin Activity Logic & Streaming --------------------------------------
async function streamCoinActivity(addresses = [], minutes = 15, params = {}, res) {
  const { coin, minNotional = 0 } = params;
  if (!coin) throw new Error('coinActivity requires a `coin` param');

  const end = Date.now();
  const start = end - minutes * 60_000;
  let fillsWindow = [];

  for (const addr of addresses) {
    res.write(JSON.stringify({ trader: addr, stage: 'fetching' }) + '\n');
    const fills = await sdk.info.getUserFillsByTime(addr, start, end).catch(() => []);
    res.write(JSON.stringify({ trader: addr, stage: 'fetched', count: fills.length }) + '\n');

    const matches = fills.filter(f => f.coin === coin && Math.abs(Number(f.sz)) * Number(f.px) >= minNotional);
    fillsWindow = fillsWindow.concat(matches.map(f => ({ trader: addr, time: f.time*1000, side: f.dir.includes('Long') ? 'buy' : 'sell', sizeUsd: + (Math.abs(Number(f.sz)) * Number(f.px)).toFixed(2), price: +f.px })));
    res.write(JSON.stringify({ trader: addr, stage: 'filtered', matches: matches.length }) + '\n');
  }

  // summary
  const totalTrades = fillsWindow.length;
  const totalNotional = fillsWindow.reduce((sum, t) => sum + t.sizeUsd, 0);
  const uniqueTraders = new Set(fillsWindow.map(t => t.trader));
  res.write(JSON.stringify({ coinActivitySummary: { coin: params.coin, lookbackMinutes: minutes, totalTrades, totalNotional: +totalNotional.toFixed(2), uniqueTraderCount: uniqueTraders.size } }) + '\n');
}

app.post('/api/coinActivityStream', async (req, res) => {
  const { minutes, params, addresses, filters } = req.body;
  let addrs;
  try {
    addrs = Array.isArray(addresses) && addresses.length ? addresses : await fetchTraderAddresses(filters || {});
  } catch (err) {
    console.error('Error fetching addresses:', err);
    return res.status(500).json({ error: err.message });
  }

  console.log(`→ Streaming coinActivity(${params.coin}) on ${addrs.length} addresses`);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  await streamCoinActivity(addrs, minutes || 15, params || {}, res);
  res.end();
});

// -- Coin Activity Non-Stream Endpoint -----------------------------------
app.post('/api/coinActivity', async (req, res) => {
  const { minutes, params, addresses, filters } = req.body;
  try {
    const addrs = Array.isArray(addresses) && addresses.length ? addresses : await fetchTraderAddresses(filters || {});
    console.log(`→ coinActivity(${params.coin}) on ${addrs.length} addresses`);
    const data = await (async () => {
      const { coin, minNotional = 0 } = params;
      const end = Date.now();
      const start = end - (minutes || 15) * 60_000;
      let fillsWindow = [];
      for (const addr of addrs) {
        const fills = await sdk.info.getUserFillsByTime(addr, start, end).catch(() => []);
        fillsWindow = fillsWindow.concat(
          fills.filter(f => f.coin === coin && Math.abs(Number(f.sz))*Number(f.px)>=minNotional)
            .map(f => ({ trader: addr, time: f.time*1000, side: f.dir.includes('Long')?'buy':'sell', sizeUsd: +(Math.abs(Number(f.sz))*Number(f.px)).toFixed(2), price: +f.px }))
        );
      }
      return {
        coinActivity: {
          coin: params.coin,
          lookbackMinutes: minutes || 15,
          totalTrades: fillsWindow.length,
          totalNotional: +fillsWindow.reduce((s,t)=>s+t.sizeUsd,0).toFixed(2),
          uniqueTraderCount: new Set(fillsWindow.map(t=>t.trader)).size,
          recentFills: fillsWindow.slice(0,20)
        }
      };
    })();
    res.json(data);
  } catch (err) {
    console.error('Error in coinActivity:', err);
    res.status(500).json({ error: err.message });
  }
});

// -- Market Sentiment Logic (Non-Stream) ----------------------------------
async function marketSentiment(addresses = []) {
  let totalLong = 0;
  let totalShort = 0;

  for (const wallet of addresses) {
    const state = await sdk.info.perpetuals.getClearinghouseState(wallet).catch(() => ({}));
    const positions = state.assetPositions || [];
    for (const p of positions) {
      const sz = Number(p.position.szi);
      const px = Number(p.position.entryPx);
      const val = Math.abs(sz) * px;
      if (sz > 0) totalLong += val;
      else if (sz < 0) totalShort += val;
    }
  }

  const grand = totalLong + totalShort;
  const longPct = grand ? +(totalLong / grand * 100).toFixed(2) : 0;
  const shortPct = grand ? +(totalShort / grand * 100).toFixed(2) : 0;

  return {
    sentiment: { longPct, shortPct, totalLongUsd: +totalLong.toFixed(2), totalShortUsd: +totalShort.toFixed(2) }
  };
}

// -- Market Sentiment Endpoint -------------------------------------------
app.post('/api/marketSentiment', async (req, res) => {
  const { addresses, filters } = req.body;
  try {
    const addrs = Array.isArray(addresses) && addresses.length ? addresses : await fetchTraderAddresses(filters || {});
    console.log(`→ marketSentiment on ${addrs.length} addresses`);
    const data = await marketSentiment(addrs);
    res.json(data);
  } catch (err) {
    console.error('Error marketSentiment:', err);
    res.status(500).json({ error: err.message });
  }
});

// -- Market Sentiment Streaming Endpoint ----------------------------------
app.post('/api/marketSentimentStream', async (req, res) => {
  const { addresses, filters } = req.body;
  let addrs;
  try {
    addrs = Array.isArray(addresses) && addresses.length ? addresses : await fetchTraderAddresses(filters || {});
  } catch (err) {
    console.error('Error fetching addresses:', err);
    return res.status(500).json({ error: err.message });
  }

  console.log(`→ Streaming marketSentiment on ${addrs.length} addresses`);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  let totalLong = 0, totalShort = 0;
  for (const wallet of addrs) {
    res.write(JSON.stringify({ wallet, stage: 'fetching positions' }) + '\n');
    const state = await sdk.info.perpetuals.getClearinghouseState(wallet).catch(() => ({}));
    const positions = state.assetPositions || [];
    res.write(JSON.stringify({ wallet, stage: 'positions count', count: positions.length }) + '\n');

    for (const p of positions) {
      const sz = Number(p.position.szi);
      const px = Number(p.position.entryPx);
      const val = Math.abs(sz) * px;
      if (sz > 0) totalLong += val;
      else if (sz < 0) totalShort += val;
    }
  }

  const grand = totalLong + totalShort;
  const longPct = grand ? +(totalLong / grand * 100).toFixed(2) : 0;
  const shortPct = grand ? +(totalShort / grand * 100).toFixed(2) : 0;
  res.write(JSON.stringify({ sentiment: { longPct, shortPct, totalLongUsd: +totalLong.toFixed(2), totalShortUsd: +totalShort.toFixed(2) } }) + '\n');
  res.end();
});

// 8. Asset Concentration Logic (Non-Stream)
async function assetConcentration(addresses = []) {
  let counts = {};

  for (const addr of addresses) {
    const stateRes = await sdk.info.perpetuals.getClearinghouseState(addr).catch(() => ({}));
    const positions = stateRes.assetPositions || [];

    // sum sizes by coin
    const netByCoin = {};
    for (const p of positions) {
      const sz = Number(p.position.szi);
      if (!sz) continue;
      netByCoin[p.position.coin] = (netByCoin[p.position.coin] || 0) + sz;
    }

    // update counts
    for (const [coin, net] of Object.entries(netByCoin)) {
      counts[coin] = counts[coin] || { longCount: 0, shortCount: 0 };
      if (net > 0) counts[coin].longCount++;
      else if (net < 0) counts[coin].shortCount++;
    }
  }

  // format and sort
  const result = Object.entries(counts)
    .map(([coin, { longCount, shortCount }]) => ({
      coin: `${coin}-PERP`, longCount, shortCount, total: longCount + shortCount
    }))
    .sort((a, b) => b.total - a.total);

  return { concentration: result };
}

// Asset Concentration Endpoint
app.post('/api/assetConcentration', async (req, res) => {
  const { addresses, filters } = req.body;
  try {
    const addrs = Array.isArray(addresses) && addresses.length
      ? addresses
      : await fetchTraderAddresses(filters || {});

    console.log(`→ assetConcentration on ${addrs.length} addresses`);
    const data = await assetConcentration(addrs);
    res.json(data);
  } catch (err) {
    console.error('Error in assetConcentration:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────
// 5.  🔥 NEW  –  Ticker Feed (liquidations + trades)
// ──────────────────────────────────────────────────────────────────
const GQL_ENDPOINT = 'https://api.hyperliquid.xyz/graphql';
const LIQ_QUERY = `query($coin:String!,$start:DateTime!){\n  liquidationHistory(start:$start,end:null,coin:$coin){coin side sz px timestamp}\n}`;

async function fetchLiquidations(coin, minutes=30){
  const startISO = new Date(Date.now()-minutes*60_000).toISOString();
  const resp = await axios.post(GQL_ENDPOINT,{query:LIQ_QUERY,variables:{coin,start:startISO}}).catch(()=>({data:{data:null}}));
  return resp.data.data?.liquidationHistory || [];
}

// ───── NEW ─────
// ──────────────────────────────────────────────────────────────────
// 0.  UNIVERSAL TRADE‑FETCH HELPER (works on any SDK version)
// ──────────────────────────────────────────────────────────────────
const TRADES_HTTP = (coin, limit) =>
  `https://api.hyperliquid.xyz/trades?market=${encodeURIComponent(coin)}&limit=${limit}`;

const TRADES_GQL = `query($market:String!,$limit:Int!){\n  trades(market:$market,limit:$limit){px sz side timestamp}}`;

async function fetchRecentTrades (coin, limit = 60) {
  try {
    /* ≥ 2024‑05 builds – sdk.info.trades({ market, limit }) */
    if (typeof sdk.info.trades === 'function') {
      const res = await sdk.info.trades({ market: coin, limit });
      if (Array.isArray(res)) return res;
    }
    /* 2023‑12 → 2024‑03 – sdk.info.getTrades(...)  */
    if (typeof sdk.info.getTrades === 'function') {
      const res = sdk.info.getTrades.length === 1
        ? await sdk.info.getTrades({ market: coin, limit })
        : await sdk.info.getTrades(coin, limit);
      if (Array.isArray(res)) return res;
    }
    /* older – sdk.info.market.getTrades(...)  */
    if (sdk.info.market?.getTrades) {
      const res = await sdk.info.market.getTrades(coin, limit);
      if (Array.isArray(res)) return res;
    }
    /* very old – sdk.info.perpetuals.getTrades(...) */
    if (sdk.info.perpetuals?.getTrades) {
      const res = await sdk.info.perpetuals.getTrades(coin, limit);
      if (Array.isArray(res)) return res;
    }

    /* ----------  no helper  →  public endpoints  ---------- */
    console.warn('getTrades helper not found – falling back to HTTP / GQL');

    // A. unauthenticated REST
    const httpRes = await axios.get(TRADES_HTTP(coin, limit)).catch(() => null);
    if (httpRes?.data && Array.isArray(httpRes.data)) return httpRes.data;

    // B. last‑resort GraphQL
    const gqlRes = await axios.post('https://api.hyperliquid.xyz/graphql', {
      query     : TRADES_GQL,
      variables : { market: coin, limit }
    }).catch(() => null);
    return gqlRes?.data?.data?.trades ?? [];
  } catch (err) {
    console.warn('fetchRecentTrades failed –', err.message);
    return [];
  }
}


async function tickerFeed(coin, params={}){
  const { liqMinutes=30, tradeLimit=60 } = params;
  console.log(`↪ fetching liquidations for ${coin} (${liqMinutes} m)`);    // ⚡
  const liqs = await fetchLiquidations(coin.split('-')[0] || coin, liqMinutes);

  console.log(`↪ fetching last ${tradeLimit} trades for ${coin}`);         // ⚡
  const trades = await fetchRecentTrades(coin, tradeLimit);
  return { coin, liqMinutes, tradeLimit, liquidations: liqs, trades };
}

//  🔥  tickerFeed endpoint
app.post('/api/tickerFeed', async (req,res)=>{
  const { coin, params } = req.body;
  if (!coin) return res.status(400).json({ error:'coin is required' });
  try {
    console.log('→ tickerFeed request:', coin, params);
    res.json(await tickerFeed(coin, params||{}));
  } catch(err){
    console.error('tickerFeed error', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -- Google Sheet Endpoint ------------------------------------------------
app.get('/api/traderAddresses', async (req, res) => {
  try {
    const filters = {};
    if (req.query.pnlMin)      filters.pnlMin       = Number(req.query.pnlMin);
    if (req.query.winRateMin)  filters.winRateMin   = Number(req.query.winRateMin);
    if (req.query.durationMin) filters.durationMinMs = Number(req.query.durationMin);
    const addrs = await fetchTraderAddresses(filters);
    res.json(addrs);
  } catch (err) {
    console.error('Error fetching traders:', err);
    res.status(500).json({ error: err.message });
  }
});

// -- Start Server ---------------------------------------------------------
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 Server listening on http://localhost:${PORT}`));
}
