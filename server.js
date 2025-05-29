/*───────────────────────────────────────────────────────────────*
 *  Hyperliquid Strategy API – 2025-05-fix-levels                *
 *───────────────────────────────────────────────────────────────*/
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const axios      = require('axios');
const WebSocket  = require('ws');
const pLimit     = require('p-limit');
const { Transform, PassThrough } = require('stream');

/* ── Constants & WS setup (hoisted) ────────────────────────────── */
const WS_URL       = 'wss://api.hyperliquid.xyz/ws';
const COIN         = (process.env.FLOW_COIN ?? 'BTC').toUpperCase();
const DEPTH_LEVELS = 50;


let wss;  

// ─── Live order-book state for flowBus ─────────────────────────
let liveBook = { bids: [], asks: [] };
let depthReady = false;

/* ── flowBus for SSE proxy ──────────────────────────────────────── */
const flowBus = new PassThrough();
module.exports.flowBus = flowBus;

/* ── helpers ────────────────────────────────────────────────────── */
const limit      = pLimit(5);
const depthLimit = pLimit(4);
const sleep      = ms => new Promise(r => setTimeout(r, ms));

let heartbeatInterval = null;
let isFlowRunning     = false;

function startFlowStream() {
  if (isFlowRunning) return;
  isFlowRunning = true;

  // heartbeat
  heartbeatInterval = setInterval(() => {
    flowBus.write(`heartbeat\n\n`);
  }, 5000);

  if (wss.readyState === WebSocket.OPEN) {
    wss.send(JSON.stringify({ method:'subscribe', subscription:{ type:'trades', coin:COIN }}));
    wss.send(JSON.stringify({ method:'subscribe', subscription:{ type:'l2Book', coin:COIN, nLevels:DEPTH_LEVELS }}));
  }
  console.log('▶️ Flow stream started');
}

function stopFlowStream() {
  if (!isFlowRunning) return;
  isFlowRunning = false;
  clearInterval(heartbeatInterval);
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
        if (e?.response?.status !== 429) throw e;
        err = e;
        await sleep(delay * (i+1));
      }
    }
    throw err;
  })();
}

function patchSide(sideArr, px, sz) {
  const idx = sideArr.findIndex(([p]) => p === px);
  if (sz === 0)       sideArr.splice(idx,1);
  else if (idx === -1) sideArr.push([px,sz]);
  else                 sideArr[idx][1] = sz;
}


/* ── Express bootstrap ──────────────────────────────────────────── */
const app = express();
app.use(express.json({ limit:'5mb' }));
app.use(cors());
app.use(express.static(path.join(__dirname,'public')));
app.get('/api/__debug', (_,res) => res.json({ pid:process.pid, build:'2025-05-fix-levels' }));

/* ── SDK lazy-init ──────────────────────────────────────────────── */
const { fetchTraderAddresses } = require('./sheetHelper');
// ── SDK lazy-init ─────────────────────────────────────────────
const { Hyperliquid } = require('hyperliquid');
let sdk, initPromise;

async function getSdk () {
  if (sdk) return sdk;
  if (!initPromise) {
    initPromise = (async () => {
      const inst = new Hyperliquid(
        process.env.HL_PRIVATE_KEY || '',
        false,
        process.env.HL_API_WALLET || ''
      );

      for (let i = 0; i < 5; i++) {
        try {
          await inst.connect();                           // opens the WS & pulls meta

          /* optional asset-map refresh (only if helper exists) */
          if (typeof inst.refreshAssetMaps === 'function') {
            await retry(() => inst.refreshAssetMaps(), { max: 3, delay: 700 });
          }

          sdk = inst;
          return sdk;
        } catch (err) {
          if (err.code !== 429) throw err;                // bubble unexpected errors
          await sleep(700 * (i + 1));                     // 0.7 s, 1.4 s, 2.1 s …
        }
      }
      throw new Error('Failed to initialise Hyperliquid SDK');
    })();
  }
  return initPromise;
}

async function get30dMedianLiquidity(symbol) {
  /* TODO: replace with real calculation or DB lookup */
  console.warn('[liquidity-median] stubbed – always returns 0');
  return 0;          // safe default
}

async function safeJson(resp) {
  try {
    return await resp.data              // axios already parses if JSON
            ? resp.data                 // happy path
            : JSON.parse(await resp.text()); // for fetch()
  } catch (e) {
    const txt = (await resp.text?.())?.slice?.(0,120) || '';
    throw new Error('Upstream not JSON → ' + txt);
  }
}

/*───────────────────────────────────────────────────────────────*
 *  SSE / Flow endpoints                                      *
 *───────────────────────────────────────────────────────────────*/
app.get('/flow', (req, res) => {
  res.writeHead(200, {
    'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', Connection:'keep-alive'
  });
  flowBus.pipe(res);
  req.on('close', () => flowBus.unpipe(res));
});
app.post('/startFlow', (_,res) => { startFlowStream(); res.json({status:'started'}); });
app.post('/stopFlow',  (_,res) => { stopFlowStream();  res.json({status:'stopped'}); });

/*───────────────────────────────────────────────────────────────*
 *  Symbol normaliser & L2 snapshot                            *
 *───────────────────────────────────────────────────────────────*/
const norm = s => s.replace(/-PERP$/i,'').toUpperCase();
const bookCache = new Map();
async function getL2Book(raw, depth=50) {
  const coin = norm(raw), key=`${coin}:${depth}`, now=Date.now();
  const hit = bookCache.get(key);
  const sdk = await getSdk();
  if (hit && now - hit.t < 250) return hit.data;
  const snap = await depthLimit(async () => {
    if (typeof sdk.info?.getL2Book === 'function') {
      try { return sdk.info.getL2Book.length===1 
        ? await sdk.info.getL2Book({market:coin,depth})
        : await sdk.info.getL2Book(coin,depth);
      } catch {}
    }
    if (sdk.info?.orderbook?.getL2Book) {
      try { return await sdk.info.orderbook.getL2Book({market:coin,depth}); } catch {}
    }
    const { data } = await retry(() => axios.post(
      'https://api.hyperliquid.xyz/info', {type:'l2Book',coin,depth}, {timeout:5_000}
    ));
    const toPair = ({px,sz}) => [+px,+sz];
    return { bids:data.levels[0].map(toPair), asks:data.levels[1].map(toPair) };
  });
  bookCache.set(key,{t:now,data:snap});
  return snap;
}

/*───────────────────────────────────────────────────────────────*
 *  Order-Book Imbalance & util                                 *
 *───────────────────────────────────────────────────────────────*/
function depthDiff(a,b){
  const m=arr=>new Map(arr.map(([p,s])=>[+p,+s]));
  const [aB,bB,aA,bA]=[m(a.bids),m(b.bids),m(a.asks),m(b.asks)];
  let be=0,ae=0;
  for (let [p,s] of aB) be+=Math.max(0,s-(bB.get(p)||0));
  for (let [p,s] of aA) ae+=Math.max(0,s-(bA.get(p)||0));
  return { bidEaten:be, askEaten:ae };
}
async function getObImbalance(coin,depthLv=20) {
  const s = await getL2Book(coin);
  const sum = arr=>arr.slice(0,depthLv).reduce((z,[,sz])=>z+sz,0);
  const bid=sum(s.bids), ask=sum(s.asks);
  return { ts:Date.now(), bidDepth:bid, askDepth:ask,
           ratio:+(bid/ask).toFixed(2), trigger: bid/ask>=1.4||bid/ask<=0.6 };
}

/*───────────────────────────────────────────────────────────────*
 *  WebSocket handler for flowBus                                *
 *───────────────────────────────────────────────────────────────*/

function connectWs (attempt = 0) {
  wss = new WebSocket(WS_URL);

  /* ── on open – resubscribe if the stream is running ───────── */
  wss.on('open', () => {
    console.log('[flow] WS connected');
    attempt = 0;         // reset back-off
    if (isFlowRunning) {
      wss.send(JSON.stringify({
        method: 'subscribe',
        subscription: { type: 'trades', coin: COIN }
      }));
      wss.send(JSON.stringify({
        method: 'subscribe',
        subscription: { type: 'l2Book', coin: COIN, nLevels: DEPTH_LEVELS }
      }));
    }
  });

  /* ── unified message handler ──────────────────────────────── */
  wss.on('message', raw => {
    // raw dump (helps when debugging)
    console.log('[WS-raw]', raw.toString().slice(0, 110));

    /* ignore everything while stream is paused */
    if (!isFlowRunning) return;

    let msg;
    try { msg = JSON.parse(raw); }           // { channel, data }
    catch { return; }

    const { channel, data: payload } = msg;

    /* 1 ░ Order-book snapshots / patches ───────────────────── */
    if (channel.startsWith('l2Book')) {
      console.log('[l2]', payload.levels ? 'SNAP' : 'PATCH');

      if (payload.levels) {                       // full snapshot
        liveBook.bids = payload.levels[0].map(l => [+l.px, +l.sz]);
        liveBook.asks = payload.levels[1].map(l => [+l.px, +l.sz]);
        depthReady = true;
      } else if (payload.updates) {               // incremental patch
        payload.updates.forEach(([side, px, sz]) =>
          patchSide(side === 0 ? liveBook.bids : liveBook.asks, +px, +sz)
        );
      }
      return;                                     // nothing else to do
    }

    /* 2 ░ Trades  →  absorption / exhaustion ───────────────── */
    if (channel === 'trades' && depthReady) {
      /* Hyperliquid sometimes wraps trades in different keys */
      const tradesArr =
            Array.isArray(payload)        ? payload
          : Array.isArray(payload.trades) ? payload.trades
          : Array.isArray(payload.data)   ? payload.data
          : [];

      console.log('[trades] batch', tradesArr.length);

      tradesArr.forEach(t => {
        const notional = Math.abs(+t.sz) * +t.px;        // sz * price
        if (notional < 50000) return;                        // spam guard (0 → emit all)

        /* snapshot book just BEFORE the trade */
        const pre = {
          bids: structuredClone(liveBook.bids),
          asks: structuredClone(liveBook.asks)
        };

        /* after 100 ms take another snapshot and diff what was eaten */
        setTimeout(() => {
          const post = {
            bids: structuredClone(liveBook.bids),
            asks: structuredClone(liveBook.asks)
          };

          const { bidEaten, askEaten } = depthDiff(pre, post);

          const flag     = bidEaten + askEaten > 0 ? 'absorption' : 'exhaustion';
          const SIDE_MAP = { A: 'buy', B: 'sell', S: 'sell' };
          const sideTxt  = SIDE_MAP[t.side] || t.side;

          const json = JSON.stringify({
            ts   : Date.now(),
            coin : COIN + '-PERP',
            type : flag,
            side : sideTxt,
            notional,
            price: +t.px,
            bidEaten,
            askEaten
          });

          /* fan out to all SSE listeners */
          flowBus.write(json + '\n\n');
          console.log('[flowBus] wrote →', json.slice(0, 120));
        }, 100);
      });

      return;      // done for this message
    }

    /* ignore any other channel types */
  });

  /* ── reconnect with exponential back-off ─────────────────── */
  wss.on('close', () => {
    const wait = Math.min(30, 2 ** attempt) * 1000;   // 1 s → 2 → 4 … 30
    console.warn(`[flow] WS closed — retrying in ${wait / 1000}s`);
    setTimeout(() => connectWs(attempt + 1), wait);
  });

  wss.on('error', err => {
    if (err.message.includes('429')) {
      console.warn('[flow] WS rate-limited, reconnecting…');
      wss.close();      // triggers the back-off
    } else {
      console.error('[flow] WS error:', err);
    }
  });
}

connectWs();          // kick-start the first connection



/*───────────────────────────────────────────────────────────────*
 *  SSE / JSON Streaming endpoints for OBI                     *
 *───────────────────────────────────────────────────────────────*/
app.post('/api/obImbalance', async (req,res) => {
  try {
    const {coin='BTC-PERP',depthLevels=20} = req.body||{};
    const data = await getObImbalance(coin,depthLevels);
    res.json(data);
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});

app.post('/api/obImbalanceStream', (req,res) => {
  const {coin='BTC-PERP',depthLevels=20,periodSec=2} = req.body||{};
  res.writeHead(200,{
    'Content-Type':'text/event-stream',
    'Cache-Control':'no-cache',
    Connection:'keep-alive'
  });
  res.write(':ok\n\n');
  const iv = setInterval(async () => {
    try { res.write(`data: ${JSON.stringify(await getObImbalance(coin,depthLevels))}\n\n`); }
    catch(err) { res.write(`event:error\ndata:${JSON.stringify({message:err.message})}\n\n`); }
  }, periodSec*1000);
  req.on('close', () => clearInterval(iv));
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

    const fills = await sdk.info.getUserFillsByTime(wallet, startMs, now).catch(() => []);
    res.write(JSON.stringify({ type:'log', wallet, stage:'fetched fills', count:fills.length })+'\n');

    const stateRes = await sdk.info.perpetuals.getClearinghouseState(wallet).catch(() => ({}));
    const positions = stateRes.assetPositions || [];
    +  // now it’s safe to log how many positions we saw
    res.write(JSON.stringify({
      type: 'log',
      wallet,
      stage: 'positions count',
      count: positions.length
    }) + '\n');

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

/*───────────────────────────────────────────────────────────────*
 *  Asset-Concentration  –  STREAM                              *
 *───────────────────────────────────────────────────────────────*/
async function streamAssetConcentration (addresses = [], res) {
  const sdk = await getSdk();

  const counts = {};                          // { BTC:{longCount,shortCount}, … }
  let processed = 0;

  for (const wallet of addresses) {
    /* progress-bar tick */
    res.write(JSON.stringify({ type:'log', wallet, stage:'starting scan' }) + '\n');

    const state = await sdk.info.perpetuals
      .getClearinghouseState(wallet)
      .catch(() => ({}));
    const positions = state.assetPositions || [];

    /* aggregate longs / shorts for this wallet */
    const netByCoin = {};
    for (const p of positions) {
      const net = Number(p.position.szi);
      if (!net) continue;
      netByCoin[p.position.coin] = (netByCoin[p.position.coin] || 0) + net;
    }

    /* update global counts */
    for (const [coin, net] of Object.entries(netByCoin)) {
      counts[coin] = counts[coin] || { longCount:0, shortCount:0 };
      if (net > 0) counts[coin].longCount++; else if (net < 0) counts[coin].shortCount++;
    }

    processed++;
  }

  /* final summary (sorted, prettified) */
  const concentration = Object.entries(counts)
    .map(([coin, { longCount, shortCount }]) => ({
      coin:`${coin}-PERP`, longCount, shortCount,
      total: longCount + shortCount
    }))
    .sort((a, b) => b.total - a.total);

  res.write(JSON.stringify({ type:'summary', concentration }) + '\n');
}

app.post('/api/assetConcentrationStream', async (req, res) => {
  const { addresses, filters } = req.body || {};
  const addrs = Array.isArray(addresses) && addresses.length
    ? addresses
    : await fetchTraderAddresses(filters || {});

  console.log(`→ Streaming assetConcentration on ${addrs.length} wallets`);
  res.setHeader('Content-Type','application/json; charset=utf-8');
  await streamAssetConcentration(addrs, res);
  res.end();
});


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
    const str = chunk.toString().trim();
    // if the chunk already starts with "data:" don’t double-prefix
    cb(null,
       str.startsWith('data:') ? str + '\n\n'
                               : 'data: ' + str + '\n\n');
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

async function get24hMetrics(coin) {
  // TODO: replace with real logic (e.g. query your database or replay the last 24h of flowBus events)
  return {
    squeezeWarnings: 0,
    bigAbsorptions : 0
  };
}
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

// 1. order-book snapshot -------------------------------------------------

//------------------------------------------------------------------
//  GET /books/:symbol  – order-book snapshot proxy
//------------------------------------------------------------------
app.get('/books/:symbol', async (req, res) => {
  const coinCore = req.params.symbol.replace(/-PERP$/i, '').toUpperCase(); // "BTC"
  const depth    = Math.max(5, Math.min(+req.query.depth || 40, 200));     // 5 … 200
  const MAX_RETRY = 3;

  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    try {
      const { data } = await axios.post(
        'https://api.hyperliquid.xyz/info',
        { type: 'l2Book', coin: coinCore, depth },
        { timeout: 4_000 }
      );

      if (!Array.isArray(data?.levels)) throw new Error('bad payload');

      return res.json({
        bids: data.levels[0].map(({ px, sz }) => [+px, +sz]),
        asks: data.levels[1].map(({ px, sz }) => [+px, +sz])
      });
    } catch (err) {
      /* 429 ⇒ short back-off and retry, everything else → break   */
      if (err.response?.status === 429 && attempt < MAX_RETRY - 1) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      console.error('books proxy:', err.message);
      break;
    }
  }
  res.status(502).json({ error: 'Upstream unavailable' });
});

// 2. rolling 30-day median liquidity ------------------------------------
app.get('/api/liquidity-median/:symbol', async (req, res) => {
  const { symbol } = req.params;

  // however you compute / cache this metric server-side ⬇︎
  const med = await get30dMedianLiquidity(symbol);   // your own helper
  res.json({ symbol, medianDepth10k: med });
});

app.get('/health', (req, res) => res.send('ok'));

app.get('/api/24hMetrics', async (req,res)=>{
  const coin=req.query.coin||'BTC-PERP';
  res.json(await get24hMetrics(coin));  // ← you coded this in the flow bus section
});

// -- Start Server ---------------------------------------------------------
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 Server listening on http://localhost:${PORT}`));
}
