/*───────────────────────────────────────────────────────────────*
 *  Hyperliquid Strategy API – 2025-05-fix-levels                *
 *───────────────────────────────────────────────────────────────*/
require('dotenv').config();
/* ── NEW: bus that every client can tap via SSE ─────────────── */
const { Transform } = require('stream');
const { PassThrough } = require('stream');
const flowBus = new PassThrough();        //  <-- THIS is what we write to
module.exports.flowBus = flowBus;         //  re-use in other modules

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const axios   = require('axios');
const WebSocket = require('ws');
const pLimit  = require('p-limit');

/* ── helpers ────────────────────────────────────────────────── */
const limit       = pLimit(5);      // for fills, etc.
const depthLimit  = pLimit(4);      // ≤4 concurrent /info snapshots
const sleep       = ms => new Promise(r => setTimeout(r, ms));

let heartbeatInterval = null;
let isFlowRunning = false;

function startFlowStream() {
  if (isFlowRunning) return;
  isFlowRunning = true;

  // Heartbeat every 5s to keep SSE & proxies alive
  heartbeatInterval = setInterval(() => {
    flowBus.write(`data: heartbeat\n\n`);
  }, 5000);
  console.log('▶️ Flow stream started');

  // ── now subscribe the WS (if not already open) ─────────
   if (wss.readyState === WebSocket.OPEN) {
     wss.send(JSON.stringify({ method:'subscribe', subscription:{ type:'trades', coin:COIN }}));
     wss.send(JSON.stringify({ method:'subscribe', subscription:{ type:'l2Book', coin:COIN, nLevels:DEPTH_LEVELS }}));
   }

}

function stopFlowStream() {
  if (!isFlowRunning) return;
  isFlowRunning = false;
  clearInterval(heartbeatInterval);
  heartbeatInterval = null;

   // ── unsubscribe / close WS if desired ────────────────
   wss.send(JSON.stringify({ method:'unsubscribe', subscription:{ type:'trades', coin:COIN }}));
   wss.send(JSON.stringify({ method:'unsubscribe', subscription:{ type:'l2Book', coin:COIN, nLevels:DEPTH_LEVELS }}));

  console.log('⏹ Flow stream stopped');
}

function retry(fn, { max = 4, delay = 300 } = {}) {
  return (async () => {
    let err;
    for (let i = 0; i < max; i++) {
      try { return await fn(); }
      catch (e) {
        if (e?.response?.status !== 429) throw e;   // not rate-limit
        err = e;
        await sleep(delay * (i + 1));               // back-off
      }
    }
    throw err;
  })();
}

/* ── express bootstrap ─────────────────────────────────────── */
const app = express();
app.get('/api/__debug', (_,res)=>res.json({pid:process.pid,build:'2025-05-fix-levels'}));
app.use(express.json({ limit:'5mb' }));
app.use(cors());
app.use(express.static(path.join(__dirname,'public')));

/* ── external deps ─────────────────────────────────────────── */
const { fetchTraderAddresses } = require('./sheetHelper');
const { Hyperliquid }         = require('hyperliquid');

let sdk = null;
let initPromise = null;

function getSdk() {
  if (sdk) return Promise.resolve(sdk);
  if (initPromise) return initPromise;

  // kick off initialization once
  initPromise = (async () => {
    const inst = new Hyperliquid(
      process.env.HL_PRIVATE_KEY || '',
      false,
      process.env.HL_API_WALLET || ''
    );
    // retry up to N times with back-off
    for (let i = 0; i < 5; i++) {
      try {
        await inst.connect();      // or await inst.initialize()
        sdk = inst;
        return sdk;
      } catch (err) {
        if (err.code !== 429) throw err;
        await new Promise(r => setTimeout(r, 500 * (i+1)));
      }
    }
    throw new Error('Could not initialize Hyperliquid SDK after retries');
  })();
  return initPromise;
}

// SSE endpoint
app.get('/flow', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  // pipe our flowBus into the response
  flowBus.pipe(res);

  // unpipe when client disconnects
  req.on('close', () => {
    flowBus.unpipe(res);
  });
});

// Control endpoints
app.post('/startFlow', (req, res) => {
  startFlowStream();
  res.json({ status: 'started' });
});

app.post('/stopFlow', (req, res) => {
  stopFlowStream();
  res.json({ status: 'stopped' });
});

/*──────────────────────────────────────────────────────────────*
 *  0.   SYMBOL NORMALISER                                      *
 *──────────────────────────────────────────────────────────────*/
const norm = s => s.replace(/-PERP$/i,'').toUpperCase();

/*──────────────────────────────────────────────────────────────*
 *  1.   BEST-EFFORT L2 BOOK SNAPSHOT                           *
 *──────────────────────────────────────────────────────────────*/
const bookCache = new Map();          // 250 ms rolling cache
async function getL2Book(raw, depth = 50) {
  const coin = norm(raw);
  const key  = `${coin}:${depth}`;
  const now  = Date.now();
  const hit  = bookCache.get(key);
  const sdk  = await getSdk();
  if (hit && now - hit.t < 250) return hit.data;        // ¼-s cache

  const snap = await depthLimit(async () => {
    /* 1 ▪ modern SDK */
    if (typeof sdk.info?.getL2Book === 'function') {
      try {
        return sdk.info.getL2Book.length === 1
          ? await sdk.info.getL2Book({ market:coin, depth })
          : await sdk.info.getL2Book(coin, depth);
      } catch {/* fall through */}
    }
    /* 2 ▪ March-24 alpha */
    if (sdk.info?.orderbook?.getL2Book) {
      try { return await sdk.info.orderbook.getL2Book({ market:coin, depth }); }
      catch {/* fall through */}
    }
    /* 3 ▪ POST /info fallback */
    const { data } = await retry(() => axios.post(
      'https://api.hyperliquid.xyz/info',
      { type:'l2Book', coin, depth },
      { timeout:5_000 }
    ));
    if (!data?.levels?.length) throw new Error(`L2 snapshot for “${coin}-PERP” is empty`);
    const toPair = ({ px, sz }) => [+px, +sz];
    return { bids:data.levels[0].map(toPair), asks:data.levels[1].map(toPair) };
  });

  bookCache.set(key,{ t:now, data:snap });
  return snap;
}


/* 2️⃣   Adaptive trade fetcher — works on every SDK vintage          */
async function fetchTrades (coin, startMs, endMs) {
  /* new helper (≥ 2024-05) */
  const sdk = await getSdk();
  if (typeof sdk.info?.trades === "function") {
  try {
      return await sdk.info.trades({ market: coin, startTime: startMs, endTime: endMs });
    } catch {           // older param names
      return await sdk.info.trades({ market: coin, startTimeMs: startMs, endTimeMs: endMs });
    }
  }
  /* 2023-12 → 2024-02 helper */
  if (typeof sdk.info?.getTrades === "function") {
    return sdk.info.getTrades.length === 1
      ? sdk.info.getTrades({ market: coin, startTime: startMs, endTime: endMs })
      : sdk.info.getTrades(coin, 500);   // 2nd arg is ‘limit’ in old builds
  }
  /* GraphQL fallback (always available) */
  const GQL = "https://api.hyperliquid.xyz/graphql";
  const query = `
    query($m:String!,$s:DateTime!,$e:DateTime!){
      trades(market:$m,start:$s,end:$e){ sz }
    }`;
  const vars  = {
    m: coin,
    s: new Date(startMs).toISOString(),
    e: new Date(endMs  ).toISOString()
  };
  const resp = await axios.post(GQL, { query, variables: vars });
  return resp.data.data?.trades ?? [];
}


/*──────────────────────────────────────────────────────────────*
 *  3.   OBI & depth utilities                                  *
 *──────────────────────────────────────────────────────────────*/
function depthDiff(a,b){
  const m=arr=>new Map(arr.map(([p,s])=>[+p,+s]));
  const aB=m(a.bids), bB=m(b.bids), aA=m(a.asks), bA=m(b.asks);
  let bidEaten=0, askEaten=0;
  for(const [px,sz] of aB) bidEaten+=Math.max(0,sz-(bB.get(px)||0));
  for(const [px,sz] of aA) askEaten+=Math.max(0,sz-(bA.get(px)||0));
  return { bidEaten, askEaten };
}
async function getObImbalance(c,depthLv=20){
  const s = await getL2Book(c);
  const take = arr=>arr.slice(0,depthLv).reduce((z,[,sz])=>z+ +sz,0);
  const bid=take(s.bids), ask=take(s.asks);
  return { ts:Date.now(), bidDepth:bid, askDepth:ask,
           ratio:+(bid/ask).toFixed(2), trigger: bid/ask>=1.4||bid/ask<=0.6 };
}

app.post('/api/positionDeltaPulseStream', async (req, res) => {
  const { minutes = 10, params = {}, addresses, filters } = req.body;
  const sdk = await getSdk();
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

  const now     = Date.now();
  const startMs = now - minutes * 60_000;
  const maxHits = params.maxHits ?? Infinity;
  let hits      = 0;
  const finalHits = [];

  for (const wallet of addrs) {
    if (hits >= maxHits) break;

    // 1. tell UI how many fills we're fetching
    const fills = await sdk.info.getUserFillsByTime(wallet, startMs, now).catch(() => []);
    res.write(JSON.stringify({ type:'log', wallet, stage:'fetched fills', count: fills.length }) + '\n');

    // 2. fetch positions and then log their count
    const stateRes = await sdk.info.perpetuals.getClearinghouseState(wallet).catch(() => ({}));
    const positions = stateRes.assetPositions || [];
    res.write(JSON.stringify({ type:'log', wallet, stage:'positions count', count: positions.length }) + '\n');

    // 3. build openNow map
    const openNow = {};
    for (const p of positions) {
      const sz = Number(p.position.szi);
      if (!sz) continue;
      openNow[p.position.coin] = {
        side: sz > 0 ? 'long' : 'short',
        sizeUsd: Math.abs(sz) * Number(p.position.entryPx),
        entry:  Number(p.position.entryPx),
        liqPx:  Number(p.position.liquidationPx)
      };
    }

    // 4. aggregate opens/closes
    const opened = {}, closed = {};
    for (const f of fills) {
      const val = Math.abs(Number(f.sz)) * Number(f.px);
      if (f.dir.startsWith('Open'))  opened[f.coin] = (opened[f.coin] || 0) + val;
      if (f.dir.startsWith('Close')) closed[f.coin] = (closed[f.coin] || 0) + val;
    }

    // 5. detect events per coin
    for (const coin of new Set([...Object.keys(opened), ...Object.keys(closed)])) {
      if (hits >= maxHits) break;
      const oUsd = opened[coin] || 0;
      const cUsd = closed[coin] || 0;
      const st   = openNow[coin];

      const reduced     = (st && st.side === 'long'  && cUsd >= params.trimUsd)
                        || (st && st.side === 'short' && cUsd >= params.trimUsd)
                        || (!st && cUsd >= params.trimUsd);
      const added       = st && ((st.side === 'long'  && oUsd >= params.addUsd)
                              || (st.side === 'short' && oUsd >= params.addUsd));
      const openedFresh = !st && oUsd >= params.newUsd;

      res.write(JSON.stringify({
        type:'log',
        wallet,
        coin:`${coin}-PERP`,
        stage:'evaluated',
        openedUsd:+oUsd.toFixed(2),
        closedUsd:+cUsd.toFixed(2),
        reduced, added, openedFresh
      }) + '\n');

      if (reduced || added || openedFresh) {
        const entry = {
          type   : 'result',
          wallet,
          coin   : `${coin}-PERP`,
          action : reduced ? 'reduced' : added ? 'added' : 'opened',
          side   : st?.side || (oUsd > cUsd ? 'long' : 'short'),
          sizeUsd: st ? +st.sizeUsd.toFixed(2) : 0,
          avgEntry: st ? +st.entry.toFixed(2) : null,
          liqPx  : st ? +st.liqPx.toFixed(2) : null
        };
        res.write(JSON.stringify(entry) + '\n');
        finalHits.push(entry);
        hits++;
      }
    }
  }

  // 6. summary
  res.write(JSON.stringify({ type:'summary', results: finalHits }) + '\n');
  res.end();
});

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
  const sdk = await getSdk();
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
     res.write(JSON.stringify({ type:'log', wallet,
                            stage:'positions count',
                            count: positions.length })+'\n');

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



/*───────────────────────────────────────────────────────────────*
 *  3.  WEBSOCKET – initiative flow + live depth                 *
 *───────────────────────────────────────────────────────────────*/

const WS_URL = 'wss://api.hyperliquid.xyz/ws';
const COIN   = (process.env.FLOW_COIN ?? 'BTC').toUpperCase();   // eg BTC
const DEPTH_LEVELS = 50;                                         // keep ≤ 50

const wss  = new WebSocket(WS_URL);

/* ── 1. subscribe to trades *and* order-book depth ───────────── */
wss.onopen = () => {
  wss.send(JSON.stringify({
    method: 'subscribe',
    subscription: { type: 'trades', coin: COIN }
  }));
  wss.send(JSON.stringify({
    method: 'subscribe',
    subscription: { type: 'l2Book', coin: COIN, nLevels: DEPTH_LEVELS }
  }));
  console.log(`[flow] subscribed to ${COIN} trades & depth`);
};

/* ── rolling order-book cache ────────────────────────────────── */
let depthReady = false;
let book = { bids: [], asks: [] };             // bids: [[px,sz] …], asks: [[px,sz] …]

/* helper to mutate a side with diff updates -------------------- */
function patchSide(sideArr, px, sz) {
  const idx = sideArr.findIndex(([p]) => p === px);
  if (sz === 0) {            // remove level
    if (idx !== -1) sideArr.splice(idx, 1);
  } else if (idx === -1) {   // new level
    sideArr.push([px, sz]);
  } else {                   // size update
    sideArr[idx][1] = sz;
  }
}

/* defensive depth-diff (guards against undefined) -------------- */
function depthDiff(pre, post) {
  const safe = x => Array.isArray(x) ? x : [];
  const mm   = a => new Map(safe(a).map(([p, s]) => [+p, +s]));

  const aB = mm(pre.bids),  bB = mm(post.bids);
  const aA = mm(pre.asks),  bA = mm(post.asks);

  let bidEaten = 0, askEaten = 0;
  for (const [px, sz] of aB) bidEaten += Math.max(0, sz - (bB.get(px) ?? 0));
  for (const [px, sz] of aA) askEaten += Math.max(0, sz - (bA.get(px) ?? 0));
  return { bidEaten, askEaten };
}

/* ── 2. main handler ─────────────────────────────────────────── */
wss.onmessage = ({ data }) => {
  if (!isFlowRunning) return;      // ← guard everything
  const { channel, data: d } = JSON.parse(data);

  /*  a. order-book snapshots / diffs  -------------------------- */
  if (channel.startsWith('l2Book')) {
    if (d.levels) {                            // full snapshot
      const toPair = ({ px, sz }) => [+px, +sz];
      book = { bids: d.levels[0].map(toPair), asks: d.levels[1].map(toPair) };
      depthReady = true;
    } else if (d.updates) {                    // incremental diff array
      d.updates.forEach(([side, px, sz]) =>
        patchSide(side === 0 ? book.bids : book.asks, +px, +sz)
      );
    }
    return;
  }

  /*  b. trades  ----------------------------------------------- */
  if (channel !== 'trades' || !depthReady) return;

  const trades = Array.isArray(d) ? d : d.trades ?? [];
  if (!trades.length) return;

  // quick console peek at first trade’s notional
  const { sz, px } = trades[0];
  console.log('[trade]', Math.abs(+sz) * +px);

  trades.forEach(t => {
    const notional = Math.abs(+t.sz) * +t.px;
    if (notional < 100000) return;                  // ignore micro ticks

    const pre = structuredClone(book);         // light copy (depth ≤ 50)

    setTimeout(() => {
      const post = structuredClone(book);
      const { bidEaten, askEaten } = depthDiff(pre, post);

      const sameSideDepth = t.side === 'buy'
        ? post.bids.slice(0, 20).reduce((s, [, q]) => s + +q, 0)
        : post.asks.slice(0, 20).reduce((s, [, q]) => s + +q, 0);

      const refilled = sameSideDepth > notional * 0.2;  // α = 50 %
      const flag     = refilled ? 'absorption' : 'exhaustion';

      flowBus.write(JSON.stringify({
        ts       : Date.now(),
        coin     : COIN + '-PERP',
        type     : flag,          // absorption | exhaustion
        side     : t.side,        // buy | sell
        notional,
        price    : +t.px,
        bidEaten,
        askEaten
      }) + '\n');
    }, 100);                                    // 100 ms look-ahead window
  });
};


// -- Coin Activity Logic & Streaming --------------------------------------
async function streamCoinActivity(addresses = [], minutes = 15, params = {}, res) {
  const sdk = await getSdk();
  const { coin, minNotional = 0 } = params;
  if (!coin) throw new Error('coinActivity requires a `coin` param');

  const end = Date.now();
  const start = end - minutes * 60_000;
  let fillsWindow = [];

  for (const addr of addresses) {
    // 🔸 tell UI a new wallet is starting  (progress tick)
    res.write(JSON.stringify({ type:'log', trader: addr, stage:'starting scan' })+'\n');

    const fills = await sdk.info.getUserFillsByTime(addr, start, end).catch(() => []);

    res.write(JSON.stringify({ type:'log', trader: addr, stage:'fetched', count: fills.length })+'\n');


    const matches = fills.filter(f => f.coin === coin && Math.abs(Number(f.sz)) * Number(f.px) >= minNotional);

      // 🔸 stream every qualifying fill (so UI mirrors Delta behaviour)
      for (const hit of matches) {
        const entry = {
          type : 'result',
          trader : addr,
          coin,
          side   : hit.dir.includes('Long') ? 'buy' : 'sell',
          sizeUsd: +(Math.abs(+hit.sz) * +hit.px).toFixed(2),
          price  : +(+hit.px).toFixed(2),
          ts     : hit.time*1000
        };
        res.write(JSON.stringify(entry)+'\n');
      }    

    fillsWindow = fillsWindow.concat(matches.map(f => ({ trader: addr, time: f.time*1000, side: f.dir.includes('Long') ? 'buy' : 'sell', sizeUsd: + (Math.abs(Number(f.sz)) * Number(f.px)).toFixed(2), price: +f.px })));
    res.write(JSON.stringify({ type:'log', trader: addr, stage:'filtered', matches: matches.length })+'\n');
  }

  // summary
  const totalTrades = fillsWindow.length;
  const totalNotional = fillsWindow.reduce((sum, t) => sum + t.sizeUsd, 0);
  const uniqueTraders = new Set(fillsWindow.map(t => t.trader));
  res.write(JSON.stringify({ type:'summary', coinActivitySummary: { coin: params.coin, lookbackMinutes: minutes, totalTrades, totalNotional: +totalNotional.toFixed(2), uniqueTraderCount: uniqueTraders.size } }) + '\n');
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
  const sdk = await getSdk();
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
  const sdk = await getSdk();
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

// ── Market-Sentiment - STREAM — upgraded ───────────────────────────────
app.post('/api/marketSentimentStream', async (req, res) => {
  const sdk = await getSdk();
  const { addresses, filters } = req.body;

  /* 1 ▪ resolve wallet list (sheet or explicit) */
  let addrs;
  try {
    addrs = Array.isArray(addresses) && addresses.length
      ? addresses
      : await fetchTraderAddresses(filters || {});
  } catch (err) {
    console.error('Error fetching addresses:', err);
    return res.status(500).json({ error: err.message });
  }

  console.log(`→ Streaming marketSentiment on ${addrs.length} addresses`);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.flushHeaders();  

  /* running totals */
  let totalLong  = 0;
  let totalShort = 0;
  let processed  = 0;

  /* 2 ▪ loop through wallets and stream progress */
  for (const wallet of addrs) {
    /* — start cue (progress-bar tick) — */
    res.write(JSON.stringify({ type:'log', wallet, stage:'starting scan' }) + '\n');

    /* fetch positions */
    const state = await sdk.info.perpetuals
      .getClearinghouseState(wallet)
      .catch(() => ({}));
    const positions = state.assetPositions || [];

    /* detail log (optional) */
    res.write(
      JSON.stringify({ type:'log', wallet, stage:'positions count', count: positions.length }) + '\n'
    );

    /* aggregate longs / shorts */
    for (const p of positions) {
      const sz = +p.position.szi;
      const px = +p.position.entryPx;
      const usd = Math.abs(sz) * px;
      if (sz > 0) totalLong  += usd;
      else if (sz < 0) totalShort += usd;
    }

    processed++;
    const grand = totalLong + totalShort;

    /* — partial snapshot — */
    if (grand) {
      res.write(
        JSON.stringify({
          type      : 'partial',
          longPct   : +(totalLong  / grand * 100).toFixed(2),
          shortPct  : +(totalShort / grand * 100).toFixed(2),
          processed,
          total     : addrs.length
        }) + '\n'
      );
    }
  }

  /* 3 ▪ final summary */
  const grand = totalLong + totalShort;
  res.write(
    JSON.stringify({
      type      : 'summary',
      sentiment : {
        longPct       : grand ? +(totalLong  / grand * 100).toFixed(2) : 0,
        shortPct      : grand ? +(totalShort / grand * 100).toFixed(2) : 0,
        totalLongUsd  : +totalLong .toFixed(2),
        totalShortUsd : +totalShort.toFixed(2)
      }
    }) + '\n'
  );

  res.end();
});


// 8. Asset Concentration Logic (Non-Stream)
async function assetConcentration(addresses = []) {
  const sdk = await getSdk();
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

// ───── NEW ─────
// ──────────────────────────────────────────────────────────────────
// 0.  UNIVERSAL TRADE‑FETCH HELPER (works on any SDK version)
// ──────────────────────────────────────────────────────────────────
const TRADES_HTTP = (coin, limit) =>
  `https://api.hyperliquid.xyz/trades?market=${encodeURIComponent(coin)}&limit=${limit}`;

const TRADES_GQL = `query($market:String!,$limit:Int!){\n  trades(market:$market,limit:$limit){px sz side timestamp}}`;

async function fetchRecentTrades (coin, limit = 60) {
  try {
    const sdk = await getSdk();
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


// --- Order-Book Imbalance STREAM ---------------------------------
// ─── OBI snapshot ───────────────────────────────────────────────
app.post('/api/obImbalance', async (req, res) => {
  try {
    const { coin = 'BTC-PERP', depthLevels = 20 } = req.body || {};
    const data = await getObImbalance(coin, depthLevels);
    res.json(data);
  } catch (e) {
    console.error('obImbalance error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// after the existing POST /api/obImbalance   ⬇⬇
app.post('/api/obImbalanceSnapshot', (req,res) =>
  app._router.handle(req, res, () => {}, 'post', '/api/obImbalance')
);

// ─── OBI live stream ────────────────────────────────────────────
app.post('/api/obImbalanceStream', async (req, res) => {
  const {
    coin = 'BTC-PERP',
    depthLevels = 20,
    periodSec   = 2,
    durationSec = 30
  } = req.body || {};

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const loops = Math.ceil(durationSec / periodSec);

  try {
    for (let i = 0; i < loops; i++) {
      const msg = await getObImbalance(coin, depthLevels);
      res.write(JSON.stringify(msg) + '\n');   // normal tick
      /* flush every tick */
      await sleep(periodSec * 1000);
    }
    res.end();
  } catch (e) {
    console.error('obImbalanceStream:', e.message);
    res.write(JSON.stringify({ type:'error', message: e.message }) + '\n');
    res.end();
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


//------------------------------------------------------------------
//  GET /api/flowStream  – raw text stream
//------------------------------------------------------------------
app.get('/api/flowStream', (req, res) => {
  const want = (req.query.coin || '').toUpperCase();   // blank ⇒ everything

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // 0️⃣ tell EventSource we’re alive (1st comment keeps proxies open)
  res.write(':ok\n\n');

  // 1️⃣ tiny transform that keeps heartbeats & matching coin lines
  const filter = new Transform({
    transform(chunk, _, cb) {
      if (!want) return cb(null, chunk);        // no filter
      const str = chunk.toString();
      try {
        const j = JSON.parse(str);
        return j.coin?.toUpperCase() === want ? cb(null, chunk) : cb();
      } catch {
        /* heartbeats or plain text → always forward */
        return cb(null, chunk);
      }
    }
  });

// 2️⃣ pipe:  flowBus → filter → sseify → res
const sseify = new Transform({
  transform(chunk, _enc, cb) {
    // chunk already filtered — just wrap as SSE frame
    cb(null, 'data: ' + chunk.toString().trim() + '\n\n');
  }
});

flowBus.pipe(filter).pipe(sseify).pipe(res);

req.on('close', () => {
  flowBus.unpipe(filter);
  filter.destroy();
});
});

/* ------------------------------------------------------------------
   OI + funding helper (SDK first, HTTP fallback)
   -----------------------------------------------------------------*/
/* ── OI + funding snapshot ─────────────────────────────── */
async function getOiFunding (raw = 'BTC-PERP') {
  const want = raw.toUpperCase();                 // keep caller’s form
  const { data } = await axios.post(
    'https://api.hyperliquid.xyz/info',
    { type: 'metaAndAssetCtxs' },
    { timeout: 5_000 }
  );

    const names = data[0].universe.map(u =>
      typeof u === 'string'
        ? u.toUpperCase()
        : (u.name || u.ticker || u.symbol || '').toUpperCase()
    );

  /* 1️⃣ exact match (“BTC-PERP”) */
  // -- new, tolerant matcher ----------------------------------
  const wantCore = want.toUpperCase().replace(/-PERP$/, '');
  const idx = names.findIndex(n =>
    n.toUpperCase() === wantCore ||              // exact
    n.toUpperCase().replace(/-PERP$/, '') === wantCore
  );

  if (idx === -1)
    throw new Error(`coin “${raw}” not found (universe=${names.join()})`);

  const ctx = data[1][idx];                       // funding, oi, markPx …

  return {
    ts      : Date.now(),
    coin    : names[idx],                         // canonical
    oi      : +ctx.oi,
    funding : +ctx.funding,
    markPx  : +ctx.markPx
  };
}

// helper to fetch a single coin’s meta & asset‐ctx from Hyperliquid
// helper to fetch a single coin’s meta & asset‐ctx from Hyperliquid
async function getCoinData(raw = 'BTC-PERP') {
  // strip any “-PERP” suffix to get the core
  const wantCore = raw.toUpperCase().replace(/-PERP$/, '');

  // fetch the full meta + asset contexts
  const { data } = await axios.post(
    'https://api.hyperliquid.xyz/info',
    { type: 'metaAndAssetCtxs' },
    { timeout: 5_000 }
  );

  // build a normalized list of universe names (also stripping any "-PERP")
  const names = data[0].universe.map(u => {
    const n = typeof u === 'string' ? u : u.name || u.symbol || '';
    return n.toUpperCase().replace(/-PERP$/, '');
  });

  // find the index of our core coin (e.g. "BTC")
  const idx = names.findIndex(n => n === wantCore);
  if (idx === -1) {
    throw new Error(`coin ${raw} not found in universe [${names.join(', ')}]`);
  }

  // grab the matching asset context
  const ctx = data[1][idx];

  return {
    // return as full perp symbol
    coin: `${wantCore}-PERP`,
    openInterest: +ctx.oi,
    fundingRate:  +ctx.funding,
    markPrice:    +ctx.markPx
  };
}
// new endpoint:
app.get('/api/coinData', async (req, res) => {
  try {
    const coin = (req.query.coin || 'BTC-PERP').trim().toUpperCase();
    const info = await getCoinData(coin);
    res.json(info);
  } catch (err) {
    console.error('coinData error', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/obImbalanceLive', async (req, res) => {
  const coin        = (req.query.coin       || 'BTC-PERP').trim();
  const depthLevels = Number(req.query.depth)   || 20;
  const periodSec   = Number(req.query.period)  || 2;

  // SSE headers
  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection:      'keep-alive',
  });

  // send an initial comment to keep proxies happy
  res.write(':ok\n\n');

  // every tick, fetch imbalance & push as SSE “data: …”
  const iv = setInterval(async () => {
    try {
      const msg = await getObImbalance(coin, depthLevels);
      res.write(`data: ${JSON.stringify(msg)}\n\n`);
    } catch (err) {
      res.write(`event:error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
    }
  }, periodSec * 1000);

  // when client disconnects, clear the interval
  req.on('close', () => clearInterval(iv));
});

// -- Start Server ---------------------------------------------------------
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 Server listening on http://localhost:${PORT}`));
}
