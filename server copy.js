require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const axios   = require('axios');
const pLimit  = require('p-limit');
const path    = require('path');

// Google Sheets helper
const { fetchTraderAddresses } = require('./sheetHelper');

const app = express();
const HL  = process.env.HL_API_BASE || 'https://api.hyperliquid.xyz';
const limit = pLimit(5);

const fillsByTimeLimit = pLimit(1);     // only 1 at a time
const FILLS_BY_TIME_DELAY = 200;        // ms pause between each

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── HTTP POST helper ─────────────────────────────────────────────
async function hlPost(body) {
  return (await axios.post(`${HL}/info`, body, { timeout: 6000 })).data;
}

// ── Retry wrapper with backoff on 429 ────────────────────────────
async function hlPostWithRetry(body, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      return await hlPost(body);
    } catch (err) {
     if (err.response?.status === 429 && i < retries - 1) {
       // if the API tells us how long to wait, use it:
       const ra = err.response.headers['retry-after'];
       const wait = ra
         ? parseFloat(ra) * 1000
         : 500 * 2 ** i + Math.random() * 200;
       await new Promise(r => setTimeout(r, wait));
       continue;
     }
      throw err;
    }
  }
}

// ── GraphQL helper ───────────────────────────────────────────────
async function hlGQL(query, variables = {}) {
  const resp = await axios.post(
    `${HL}/graphql`,
    { query, variables },
    { timeout: 6000 }
  );
  return resp.data.data;
}

const LIQ_HISTORY = `
  query ($start: DateTime!, $end: DateTime!) {
    liquidationHistory(start: $start, end: $end) {
      coin
      side
      sz
      px
      timestamp
    }
  }
`;

async function fetchLiquidations(startSec, endSec) {
  const start = new Date(startSec * 1000).toISOString();
  const end   = new Date(endSec   * 1000).toISOString();
  const data  = await hlGQL(LIQ_HISTORY, { start, end });
  return data.liquidationHistory || [];
}

// ── Debugger collector ───────────────────────────────────────────
function makeDebugger() {
  const logs = [];
  return {
    log: (...args) => {
      const msg = args.map(a =>
        typeof a === 'object'
          ? JSON.stringify(a, null, 2)
          : a
      ).join(' ');
      console.log(msg);
      logs.push(msg);
    },
    getLogs: () => logs
  };
}

// ───────────────────────────────────────────────────────────────
// Whale-Alpha Strategies
// ───────────────────────────────────────────────────────────────
const strategies = {

  // 1. Position-Delta Pulse
  async positionDeltaPulse({ addresses = [], minutes = 10, params = {}, dbg }) {
    const { trimUsd = 0, addUsd = 0, newUsd = 0, maxHits = Infinity } = params;
    const start = Date.now() - minutes * 60_000;

    const results = [];
    const processingDetails = [];
    let hits = 0;

    await Promise.all(
      addresses.map(wallet => limit(async () => {
        if (hits >= maxHits) return;

        const dbgWallet = makeDebugger();
        processingDetails.push({ wallet, coin: null, openedUsd: 0, closedUsd: 0, passes: false, reason: 'scanned' });

        const allFills = await hlPostWithRetry({ type: 'userFills', user: wallet }).catch(() => []);
        const fills    = allFills.filter(f => f.time >= start);
        const state    = await hlPostWithRetry({ type: 'clearinghouseState', user: wallet })
                           .then(d => d.assetPositions || [])
                           .catch(() => []);

        const openNow = {};
        state.forEach(p => {
          const sz = +p.position.szi;
          if (!sz) return;
          openNow[p.position.coin] = {
            side:    sz > 0 ? 'long' : 'short',
            sizeUsd: Math.abs(sz) * +p.position.entryPx,
            entry:   +p.position.entryPx,
            liqPx:   +p.position.liquidationPx
          };
        });

        const opened = {}, closed = {};
        const bump = (tbl, coin, fld, val) => {
          tbl[coin] = { ...(tbl[coin] || { longUsd:0, shortUsd:0 }), [fld]: (tbl[coin]?.[fld] || 0) + val };
        };
        fills.forEach(f => {
          const val  = Math.abs(+f.sz) * +f.px;
          const coin = f.coin;
          const fld  = f.dir.includes('Long') ? 'longUsd' : 'shortUsd';
          if (f.dir.startsWith('Open'))  bump(opened, coin, fld, val);
          if (f.dir.startsWith('Close')) bump(closed, coin, fld, val);
        });

        for (const coin of new Set([...Object.keys(opened), ...Object.keys(closed)])) {
          if (hits >= maxHits) break;
          const st = openNow[coin];
          const oL = opened[coin]?.longUsd  || 0;
          const oS = opened[coin]?.shortUsd || 0;
          const cL = closed[coin]?.longUsd  || 0;
          const cS = closed[coin]?.shortUsd || 0;

          const reduced     = (st?.side==='long'  && cL>=trimUsd)
                            || (st?.side==='short' && cS>=trimUsd)
                            || (!st && (cL+cS)>=trimUsd);
          const added       = st && ((st.side==='long'  && oL>=addUsd)
                                   || (st.side==='short' && oS>=addUsd));
          const openedFresh = !st && (oL + oS)>=newUsd;

          dbgWallet.log(
            `[${wallet}] ${coin}: openedUsd=${(oL+oS).toFixed(2)} ` +
            `closedUsd=${(cL+cS).toFixed(2)} reduced=${reduced} ` +
            `added=${added} openedFresh=${openedFresh}`
          );

          processingDetails.push({
            wallet,
            coin:      `${coin}-PERP`,
            openedUsd: +(oL+oS).toFixed(2),
            closedUsd: +(cL+cS).toFixed(2),
            passes:    reduced||added||openedFresh,
            reason:    reduced     ? 'reduced'
                     : added       ? 'added'
                     : openedFresh ? 'openedFresh'
                     : 'none'
          });

          if (reduced || added || openedFresh) {
            results.push({
              wallet,
              action: reduced ? 'reduced' : added ? 'added' : 'opened',
              coin:   `${coin}-PERP`,
              side:   st?.side || (oL>oS ? 'long' : 'short'),
              sizeUsd: st ? +st.sizeUsd.toFixed(2) : 0,
              avgEntry: st ? +st.entry.toFixed(2) : null,
              liqPx:    st ? +st.liqPx.toFixed(2) : null
            });
            hits++;
          }
        }

        dbgWallet.getLogs().forEach(line => dbg.log(line));
      }))
    );

    return {
      results: results.length ? results : [{ result: 'no-setup' }],
      processingDetails
    };
  },

  // 2. Open-Interest Pulse
  async openInterestPulse({ addresses = [], minutes = 10, params = {}, dbg }) {
    const { deltaUsd = 250000, minWallets = 3, side = 'both' } = params;
    const start = Date.now() - minutes * 60_000;
    const processingDetails = [];
    const agg = {};

    await Promise.all(
      addresses.map(wallet => limit(async () => {
        const dbgWallet = makeDebugger();
        processingDetails.push({ wallet, stage: 'scanStart' });

        const fills = await hlPostWithRetry({
          type: 'userFillsByTime',
          user: wallet,
          startTime: start,
          endTime: Date.now(),
          aggregateByTime: false
        }).catch(() => []);

        let net = 0;
        fills.forEach(f => {
          const val = Math.abs(+f.sz) * +f.px;
          const sign = f.dir.includes('Long')
            ? (f.dir.startsWith('Close') ? -1 : 1)
            : (f.dir.startsWith('Close') ? 1 : -1);
          net += val * sign;

          if (!agg[f.coin]) agg[f.coin] = { net: 0, wallets: new Set() };
          agg[f.coin].net += val * sign;
          agg[f.coin].wallets.add(wallet);
        });

        processingDetails.push({
          wallet,
          netFlowUsd: +net.toFixed(2),
          passes:     Math.abs(net) >= deltaUsd,
          reason:     'walletNet'
        });
        dbgWallet.log(`[[${wallet}]] netFlowUsd=${net.toFixed(2)}`);
        dbgWallet.getLogs().forEach(line => dbg.log(line));
      }))
    );

    for (const [coin, data] of Object.entries(agg)) {
      const net = data.net;
      const count = data.wallets.size;
      const passesDelta   = Math.abs(net) >= deltaUsd;
      const passesWallets = count >= minWallets;
      const bias = net > 0 ? 'long' : net < 0 ? 'short' : 'flat';

      processingDetails.push({
        coin:        `${coin}-PERP`,
        netFlowUsd:  +net.toFixed(2),
        walletCount: count,
        passes:      passesDelta && passesWallets,
        reason:      'aggregate'
      });

      if (!passesDelta || !passesWallets) continue;
      if ((bias === 'long' && !['long','both'].includes(side)) ||
          (bias === 'short' && !['short','both'].includes(side))) continue;

      const topBuilders = Array.from(data.wallets)
        .slice(0,5)
        .map(addr => ({ addr, deltaUsd: +net.toFixed(2) }));

      return {
        coin:         `${coin}-PERP`,
        deltaOiUsd:   +net.toFixed(2),
        side:         bias,
        walletCount:  count,
        topBuilders,
        processingDetails
      };
    }

    return { result: 'no-oi-move', processingDetails };
  },

  // 3. Trend Bias
  async trendBias({ addresses = [], minutes = 15, params = {} }) {
    const { topN = 5, minNotional = 0 } = params;
    const start = Date.now() - minutes * 60_000;
    const processingDetails = [];
    const agg = {};

    await Promise.all(addresses.map(addr => limit(async () => {
      processingDetails.push({ wallet: addr, stage: 'scanStart' });

      const fills = await hlPostWithRetry({
        type: 'userFillsByTime',
        user: addr,
        startTime: start,
        endTime: Date.now(),
        aggregateByTime: false
      }).catch(() => []);

      const perCoin = fills.reduce((acc, f) => {
        const val = Math.abs(+f.sz) * +f.px *
          (f.dir.includes('Long')
            ? (f.dir.startsWith('Close') ? -1 :  1)
            : (f.dir.startsWith('Close') ?  1 : -1)
          );
        acc[f.coin] = (acc[f.coin] || 0) + val;
        return acc;
      }, {});

      for (const [coin, delta] of Object.entries(perCoin)) {
        const passes = Math.abs(delta) >= minNotional;
        processingDetails.push({
          wallet:      addr,
          coin:        `${coin}-PERP`,
          netNotional: +delta.toFixed(2),
          passes,
          reason:      'walletNet'
        });

        if (!agg[coin]) agg[coin] = { net: 0, wallets: new Set() };
        agg[coin].net += delta;
        agg[coin].wallets.add(addr);
      }
    })));

    const results = Object.entries(agg)
      .filter(([, v]) => Math.abs(v.net) >= minNotional)
      .map(([coin, v]) => ({
        coin:         `${coin}-PERP`,
        netNotional:  +v.net.toFixed(2),
        side:         v.net > 0 ? 'long' : 'short',
        walletCount:  v.wallets.size
      }))
      .sort((a, b) => Math.abs(b.netNotional) - Math.abs(a.netNotional))
      .slice(0, topN);

    return {
      results: results.length ? results : [{ result: 'no-trend' }],
      processingDetails
    };
  },

  // 4. Divergence Radar
  async divergenceRadar({ addresses = [], minutes = 5, params = {} }) {
    const {
      closeNotional = 50000,
      buildNotional = 50000,
      minClosers    = 2,
      minBuilders   = 2
    } = params;
    const end   = Date.now();
    const start = end - minutes * 60_000;

    console.log(`\n[DivergenceRadar] window: ${new Date(start)} → ${new Date(end)}`);

    const fillsByWallet = await Promise.all(
      addresses.map(addr => limit(async () => {
        const all = await hlPostWithRetry({
          type: 'userFillsByTime',
          user: addr,
          startTime: start,
          endTime:   end,
          aggregateByTime: false
        }).catch(() => []);
        console.log(`  wallet ${addr} → ${all.length} fills`);
        return { addr, fills: all };
      }))
    );

    const book = {};
    for (const { addr, fills } of fillsByWallet) {
      for (const f of fills) {
        const bucket = f.dir.startsWith('Close')
          ? 'closers'
          : f.dir.startsWith('Open')
            ? 'builders'
            : null;
        if (!bucket) continue;
        const val = Math.abs(+f.sz) * +f.px;
        book[f.coin] = book[f.coin] || { closers: {}, builders: {}, side: f.dir.includes('Long') ? 'long' : 'short' };
        book[f.coin][bucket][addr] = (book[f.coin][bucket][addr] || 0) + val;
      }
    }

    console.log('Built book for coins:', Object.keys(book).join(', '));
    for (const [coin, data] of Object.entries(book)) {
      const closers = Object.entries(data.closers)
        .filter(([,v]) => v >= closeNotional)
        .map(([addr,v]) => ({ addr, closed: +v.toFixed(2) }));
      const builders = Object.entries(data.builders)
        .filter(([,v]) => v >= buildNotional)
        .map(([addr,v]) => ({ addr, opened: +v.toFixed(2) }));

      console.log(`\n[${coin}] closers (${closers.length}):`, closers);
      console.log(`[${coin}] builders (${builders.length}):`, builders);

      if (closers.length >= minClosers && builders.length >= minBuilders) {
        const totalClose = closers.reduce((s,c) => s + c.closed, 0);
        const totalBuild = builders.reduce((s,b) => s + b.opened, 0);
        return {
          coin: `${coin}-PERP`,
          side: data.side,
          closers: { walletCount: closers.length, notional: totalClose.toFixed(2), top: closers.slice(0,3) },
          builders: { walletCount: builders.length, notional: totalBuild.toFixed(2), top: builders.slice(0,3) }
        };
      }
    }

    console.log('[DivergenceRadar] no coin passed thresholds');
    return { result: 'no-divergence' };
  },

  // 5. Compression Radar
  async compressionRadar({ addresses = [], minutes = 8, params = {}, dbg = console }) {
    const { rangeBp = 30, netBuildUsd = 75000, minWallets = 3, minTicks = 50 } = params;
    const end   = Date.now();
    const start = end - minutes * 60_000;
    const startSec = Math.floor(start / 1000);
    const endSec   = Math.floor(end   / 1000);

    dbg.log(`compressionRadar window: ${startSec} → ${endSec}`);

    let candles = await hlPostWithRetry({
      type: 'candleSnapshot',
      req: { coin: 'all', interval: '1s', startTime: startSec, endTime: endSec }
    }).catch(() => []);
    dbg.log(`1s-candles returned: ${candles.length}`);

    if (!candles.length) {
      dbg.log('⚠️ No 1s candles found, falling back to 1m');
      candles = await hlPostWithRetry({
        type: 'candleSnapshot',
        req: { coin: 'all', interval: '1m', startTime: startSec, endTime: endSec }
      }).catch(() => []);
      dbg.log(`1m-candles returned: ${candles.length}`);
    }

    const stats = {};
    candles.forEach(c => {
      stats[c.coin] = stats[c.coin] || { hi: -Infinity, lo: Infinity, ticks: 0 };
      const s = stats[c.coin];
      s.hi = Math.max(s.hi, +c.h);
      s.lo = Math.min(s.lo, +c.l);
      s.ticks++;
    });
    dbg.log('compressionRadar stats:', stats);

    const flows = {};
    await Promise.all(addresses.map(addr => limit(async () => {
      const fills = await hlPostWithRetry({
        type: 'userFillsByTime',
        user: addr,
        startTime: start,
        endTime: end,
        aggregateByTime: false
      }).catch(() => []);
      fills.forEach(f => {
        const val  = Math.abs(+f.sz) * +f.px;
        const sign = f.dir.includes('Long')
          ? (f.dir.startsWith('Close') ? -1 : +1)
          : (f.dir.startsWith('Close') ? +1 : -1);
        flows[f.coin] = flows[f.coin] || { net: 0, wallets: new Set(), details: {} };
        flows[f.coin].net += val * sign;
        flows[f.coin].wallets.add(addr);
        flows[f.coin].details[addr] = (flows[f.coin].details[addr] || 0) + val * sign;
      });
    })));
    dbg.log('compressionRadar flows:', flows);

    for (const [coin, st] of Object.entries(stats)) {
      if (st.ticks < minTicks) {
        dbg.log(`skip ${coin}: ${st.ticks} ticks < ${minTicks}`);
        continue;
      }
      const rangePct = 10000 * (st.hi - st.lo) / st.lo;
      dbg.log(`evaluating ${coin}: rangePct=${rangePct.toFixed(1)}bps`);
      if (rangePct > rangeBp) {
        dbg.log(`skip ${coin}: rangePct ${rangePct.toFixed(1)} > ${rangeBp}`);
        continue;
      }
      const f = flows[coin];
      if (!f) {
        dbg.log(`no flow data for ${coin}`);
        continue;
      }
      dbg.log(`flow for ${coin}: net=${f.net.toFixed(2)}, wallets=${f.wallets.size}`);
      if (Math.abs(f.net) < netBuildUsd) {
        dbg.log(`skip ${coin}: abs(net) ${Math.abs(f.net).toFixed(2)} < ${netBuildUsd}`);
        continue;
      }
      if (f.wallets.size < minWallets) {
        dbg.log(`skip ${coin}: walletCount ${f.wallets.size} < ${minWallets}`);
        continue;
      }
      dbg.log(`compressionRadar hit on ${coin}`);
      const side = f.net > 0 ? 'long' : 'short';
      const topBuilders = Object.entries(f.details)
        .sort(([,a],[,b]) => Math.abs(b) - Math.abs(a))
        .slice(0,5)
        .map(([addr,v]) => ({ addr, delta: +v.toFixed(2) }));

      return {
        coin:         `${coin}-PERP`,
        windowMinutes: minutes,
        rangeBps:     rangePct.toFixed(1),
        netBuild:     +f.net.toFixed(2),
        side,
        walletCount:  f.wallets.size,
        topBuilders,
        stats,
        flows
      };
    }

    dbg.log('compressionRadar result: no-compression');
    return { result: 'no-compression', stats, flows };
  },

  // 6. Liquidation Sniper (GraphQL)
  async liquidationSniper({ addresses = [], minutes = 2, params = {}, dbg }) {
    const {
      liqThreshold   = 1_000_000,
      buildThreshold =   100_000,
      minWallets     =         5
    } = params;

    const end   = Date.now();
    const start = end - minutes * 60_000;
    dbg.log(`→ liquidationSniper window: last ${minutes}m`, { start: new Date(start), end: new Date(end), params });

    let events = [];
    try {
      dbg.log('fetching liquidations via GraphQL…');
      events = await fetchLiquidations(
        Math.floor(start / 1000),
        Math.floor(end   / 1000)
      );
    } catch (err) {
      dbg.log('⚠️ fetch liquidations failed:', err.message);
    }
    dbg.log(`raw liquidations: ${events.length}`, events.slice(0,3));

    const cascadeTotals = {};
    for (const ev of events) {
      const sideKey = ev.side === 'long' ? 'longs' : 'shorts';
      const val     = Math.abs(+ev.sz) * +ev.px;
      cascadeTotals[ev.coin] = cascadeTotals[ev.coin] || { longs:0, shorts:0 };
      cascadeTotals[ev.coin][sideKey] += val;
    }
    dbg.log('cascadeTotals:', cascadeTotals);

    for (const [coin, totals] of Object.entries(cascadeTotals)) {
      const cascadeSide = totals.longs  >= liqThreshold ? 'longs'
                        : totals.shorts >= liqThreshold ? 'shorts'
                        : null;
      if (!cascadeSide) continue;
      dbg.log(`→ detected cascade on ${coin}:`, totals);

      const wantBuildSide = cascadeSide === 'longs' ? 'short' : 'long';
      let totalBuild = 0;
      const builds = {};

      await Promise.all(addresses.map(addr => limit(async () => {
        let fills = [];
        try {
          fills = await hlPostWithRetry({
            type: 'userFillsByTime',
            user: addr,
            startTime: start,
            endTime:   end,
            aggregateByTime: false
          }).then(d => d || []);
        } catch {}
        for (const f of fills) {
          if (f.coin !== coin) continue;
          if (f.dir.startsWith('Open') && f.dir.includes(wantBuildSide)) {
            const v = Math.abs(+f.sz) * +f.px;
            builds[addr] = (builds[addr] || 0) + v;
            totalBuild += v;
          }
        }
      })));

      dbg.log(`builds for ${coin}:`, builds);
      const builderAddrs = Object.entries(builds)
        .filter(([,v]) => v >= buildThreshold)
        .map(([addr]) => addr);
      dbg.log(`qualifying builders (${builderAddrs.length}):`, builderAddrs);
      if (builderAddrs.length < minWallets) {
        dbg.log(`→ only ${builderAddrs.length} builders (need ${minWallets}), skipping ${coin}`);
        continue;
      }

      const topBuilders = Object.entries(builds)
        .sort((a,b) => b[1] - a[1])
        .slice(0,5)
        .map(([addr,v]) => ({ addr, add: +v.toFixed(2) }));

      return {
        coin:        `${coin}-PERP`,
        cascadeSide,
        liqNotional: +(totals[cascadeSide].toFixed(2)),
        whaleBuild:  `${totalBuild.toFixed(2)} net ${wantBuildSide}`,
        walletCount: builderAddrs.length,
        topBuilders
      };
    }

    dbg.log('→ no coin met liquidationSniper criteria');
    return { result: 'no-setup' };
  },

  // 7. Market Sentiment
  async marketSentiment({ addresses = [], dbg }) {
    dbg.log(`→ marketSentiment scan start, wallets: ${addresses.length}`);

    let totalLongUsd  = 0;
    let totalShortUsd = 0;

    await Promise.all(addresses.map(addr => limit(async () => {
      let positions = [];
      try {
        const res = await hlPostWithRetry({
          type: 'clearinghouseState',
          user: addr
        });
        positions = res.assetPositions || [];
      } catch (err) {
        dbg.log(`[${addr}] clearinghouseState failed: ${err.message}`);
      }

      for (const p of positions) {
        const sz  = +p.position.szi;
        const px  = +p.position.entryPx;
        const val = Math.abs(sz) * px;
        if (sz > 0) totalLongUsd  += val;
        else if (sz < 0) totalShortUsd += val;
      }
    })));

    const grandTotal = totalLongUsd + totalShortUsd;
    const longPct  = grandTotal ? +((totalLongUsd  / grandTotal) * 100).toFixed(2) : 0;
    const shortPct = grandTotal ? +((totalShortUsd / grandTotal) * 100).toFixed(2) : 0;

    dbg.log(`  totalLongUsd=${totalLongUsd.toFixed(2)}, totalShortUsd=${totalShortUsd.toFixed(2)}`);
    dbg.log(`  sentiment → ${longPct}% long / ${shortPct}% short`);

    return {
      sentiment: {
        longPct,
        shortPct,
        totalLongUsd:  +totalLongUsd.toFixed(2),
        totalShortUsd: +totalShortUsd.toFixed(2)
      }
    };
  },

    // 8. Asset Concentration
  async assetConcentration({ addresses = [], dbg }) {
    dbg.log(`→ assetConcentration scan start, wallets: ${addresses.length}`);

    // map: coin → { longCount, shortCount }
    const counts = {};

    await Promise.all(addresses.map(addr => limit(async () => {
      let state = [];
      try {
        const res = await hlPostWithRetry({ type: 'clearinghouseState', user: addr });
        state = res.assetPositions || [];
      } catch (err) {
        dbg.log(`[${addr}] clearinghouseState failed: ${err.message}`);
      }
      // sum sizes by coin
      const netByCoin = {};
      for (const p of state) {
        const sz = +p.position.szi;
        if (!sz) continue;
        netByCoin[p.position.coin] = (netByCoin[p.position.coin] || 0) + sz;
      }
      // update counts
      for (const [coin, net] of Object.entries(netByCoin)) {
        counts[coin] = counts[coin] || { longCount: 0, shortCount: 0 };
        if (net > 0) counts[coin].longCount++;
        else if (net < 0) counts[coin].shortCount++;
      }
    })));

    // turn into array sorted by total participants
    const concentration = Object.entries(counts)
      .map(([coin, { longCount, shortCount }]) => ({
        coin: `${coin}-PERP`,
        longCount,
        shortCount,
        total: longCount + shortCount
      }))
      .sort((a,b) => b.total - a.total);

    dbg.log('→ assetConcentration result:', concentration.slice(0,5));
    return { concentration };
  },

  // 9. Trader Profitability (sheet-based)
async traderProfitability({ traders = [], dbg }) {
  dbg.log(`→ traderProfitability: ${traders.length} traders loaded`);

  const totalPnl    = traders.reduce((sum, t) => sum + (t.pnl  || 0), 0);
  const totalCount  = traders.length;
  const avgPnl      = totalCount ? totalPnl / totalCount : 0;
  const profitable  = traders.filter(t => t.pnl > 0).length;
  const perfPct     = totalCount ? (profitable/totalCount)*100 : 0;

  dbg.log(` totalPnl=${totalPnl.toFixed(2)}, avgPnl=${avgPnl.toFixed(2)}, profitable=${profitable}/${totalCount}`);

  return {
    totalPnl:    +totalPnl.toFixed(2),
    avgPnl:      +avgPnl.toFixed(2),
    profitable,
    totalCount,
    profitablePct: +perfPct.toFixed(1)
  };
},

// 10. Conviction Scanner (fixed time units)
async convictionScanner({ addresses = [], params = {}, dbg }) {
  const {
    minSizeUsd = 10_000,
    minHoldMs   = 2 * 3600e3
  } = params;

  const nowMs   = Date.now();
  const cutoffMs= nowMs - minHoldMs;
  const nowSec  = Math.floor(nowMs  / 1000);
  const cutSec  = Math.floor(cutoffMs / 1000);
  dbg.log(`→ convictionScanner start: minSizeUsd=${minSizeUsd}, minHoldSec=${cutSec}`);

  const delay = ms => new Promise(r => setTimeout(r, ms));
  const scanLimit = pLimit(1);
  const hits = [];

  await Promise.all(addresses.map(addr => scanLimit(async () => {
    await delay(200);

    // 1) fetch positions
    let positions = [];
    try {
      const res = await hlPostWithRetry({ type: 'clearinghouseState', user: addr });
      positions = res.assetPositions || [];
    } catch (err) {
      dbg.log(`[${addr}] clearinghouseState error: ${err.message}`);
      return;
    }

    // 2) fetch fills since cutSec .. nowSec
    let fills = [];
    try {
      fills = await hlPostWithRetry({
        type: 'userFillsByTime',
        user: addr,
        startTime: cutSec,
        endTime:   nowSec,
        aggregateByTime: false
      });
    } catch (err) {
      // handle 429 as before...
      dbg.log(`[${addr}] userFillsByTime error: ${err.message}`);
      fills = [];
    }

    // 3) scan each position exactly as before, using the same fills[]
    for (const pos of positions) {
      const sz      = +pos.position.szi;
      if (!sz) continue;
      const coin    = pos.position.coin;
      const entryPx = +pos.position.entryPx;
      const sizeUsd = Math.abs(sz) * entryPx;
      if (sizeUsd < minSizeUsd) continue;

      const openFills = fills
        .filter(f =>
          f.coin === coin &&
          f.dir.startsWith('Open') &&
          ((sz > 0 && f.dir.includes('Long')) ||
           (sz < 0 && f.dir.includes('Short')))
        )
        .map(f => {
          // f.time here is already in seconds, convert back to ms
          const t = f.time * 1000;
          return { time: t, px: +f.px };
        });

      if (!openFills.length) continue;

      const earliest = openFills.reduce((min, x) => x.time < min ? x.time : min, openFills[0].time);
      if (earliest > cutoffMs) continue;

      const lastPx = openFills[openFills.length - 1].px;
      const unreal = (lastPx - entryPx) * sz;

      hits.push({
        address:       addr,
        coin:          `${coin}-PERP`,
        sizeUsd:       +sizeUsd.toFixed(2),
        holdHours:     +((nowMs - earliest) / 3600e3).toFixed(2),
        unrealizedPnl: +unreal.toFixed(2)
      });
    }
  })));

  const top = hits
    .sort((a,b) => b.sizeUsd - a.sizeUsd)
    .slice(0, 10);

  dbg.log(`→ convictionScanner found ${top.length} hits`);
  return { conviction: top };
},

// 11. Order‐Flow Trigger Scanner
orderFlowTrigger: async function({ addresses = [], params = {}, dbg }) {
  const {
    minBlockUsd   = 50_000,       // only trades ≥ this USD size
    bucketWidth   = 1,            // bucket size in price units
    clusterCount  = 3,            // how many blocks in same bucket to trigger
    windowMs      = 60_000,       // lookback window for cluster (ms)
  } = params;

  const now = Date.now();
  const start = now - windowMs;
  dbg.log(`→ orderFlowTrigger start: minBlockUsd=${minBlockUsd}, bucketWidth=${bucketWidth}, clusterCount=${clusterCount}, windowMs=${windowMs}`);

  // collect all block trades across all traders
  let allBlocks = [];
  await Promise.all(addresses.map(addr => fillsByTimeLimit(async () => {
  // throttle X calls per second
  await new Promise(r => setTimeout(r, FILLS_BY_TIME_DELAY));
    // fetch fills in the window
    let fills = [];
    try {
      fills = await hlPostWithRetry({
        type: 'userFillsByTime',
        user: addr,
        startTime: start,
        endTime: now,
        aggregateByTime: false
      });
    } catch (err) {
      dbg.log(`[${addr}] userFillsByTime error: ${err.message}`);
      return;
    }
    // keep only “block” trades above threshold
    fills.forEach(f => {
      const notional = Math.abs(+f.sz) * +f.px;
      if (notional < minBlockUsd) return;
      allBlocks.push({
        trader: addr,
        coin:   f.coin,
        side:   f.dir.includes('Long') ? 'buy' : 'sell',
        price:  +f.px,
        sizeUsd: notional,
        time:   f.time * 1000  // convert to ms
      });
    });
  })));

  // bucket by (coin, side, rounded price)
  const buckets = {};
  allBlocks.forEach(b => {
    const level = Math.round(b.price / bucketWidth) * bucketWidth;
    const key = `${b.coin}|${b.side}|${level}`;
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(b);
  });

  // find clusters
  const triggers = [];
  for (const [key, trades] of Object.entries(buckets)) {
    if (trades.length < clusterCount) continue;
    // check that they all occurred within windowMs
    const times = trades.map(t=>t.time).sort();
    if (times[times.length-1] - times[0] > windowMs) continue;

    const [coin, side, level] = key.split('|');
    const totalUsd = trades.reduce((sum,t)=>sum + t.sizeUsd, 0);
    const uniqueTraders = Array.from(new Set(trades.map(t=>t.trader)));

    triggers.push({
      coin:        `${coin}-PERP`,
      side,
      priceLevel:  +level,
      blockCount:  trades.length,
      totalUsd:    +totalUsd.toFixed(2),
      traders:     uniqueTraders.slice(0,5),
      windowSeconds: windowMs/1000
    });
  }

  dbg.log(`→ orderFlowTrigger found ${triggers.length} clusters`);
  return { orderFlowTriggers: triggers };
},

// 12. Coin Activity Scanner
async coinActivity({ addresses = [], minutes = 15, params = {}, dbg }) {
  const { coin, minNotional = 0 } = params;
  if (!coin) throw new Error("coinActivity requires a `coin` param");
  const start = Date.now() - minutes * 60_000;
  const fillsWindow = [];
  
  await Promise.all(addresses.map(addr => fillsByTimeLimit(async () => {
    // 1) throttle
    await new Promise(r => setTimeout(r, FILLS_BY_TIME_DELAY));
    
    // 2) fetch with extra retries
    let fills = [];
    try {
      fills = await hlPostWithRetry({
        type: "userFillsByTime",
        user: addr,
        startTime: Math.floor(start/1000),
        endTime:   Math.floor(Date.now()/1000),
        aggregateByTime: false
      }, /*retries:*/ 8);
    } catch (err) {
      dbg.log(`[${addr}] userFillsByTime error: ${err.message}`);
      return;
    }

    // 3) filter by coin + size
    fills
      .filter(f => f.coin === coin && Math.abs(+f.sz) * +f.px >= minNotional)
      .forEach(f => fillsWindow.push({
        trader:    addr,
        time:      f.time * 1000,
        side:      f.dir.includes("Long") ? "buy" : "sell",
        sizeUsd:   +(Math.abs(+f.sz)*+f.px).toFixed(2),
        price:     +f.px
      }));
  })));


  // summarize
  const totalTrades = fillsWindow.length;
  const totalNotional = fillsWindow.reduce((sum, t) => sum + t.sizeUsd, 0);
  const uniqueTraders = Array.from(new Set(fillsWindow.map(t => t.trader)));

  dbg.log(`→ coinActivity found ${totalTrades} fills by ${uniqueTraders.length} traders`);

  return {
    coinActivity: {
      coin: `${coin}-PERP`,
      lookbackMinutes: minutes,
      totalTrades,
      totalNotional: +totalNotional.toFixed(2),
      uniqueTraderCount: uniqueTraders.length,
      recentFills: fillsWindow.slice(0, 20)  // top 20 for brevity
    }
  };
},


};

app.post('/api/hyperliquid', async (req, res) => {
  const { mode, addresses, minutes, params } = req.body;
  const dbg = makeDebugger();
  if (!strategies[mode]) {
    return res.status(400).json({ error: `Unknown mode: ${mode}` });
  }
  try {
    const result = await strategies[mode]({ addresses, minutes, params, dbg });
    res.json({ ...result, debugLogs: dbg.getLogs() });
  } catch (err) {
    console.error(`Error in ${mode}:`, err);
    res.status(500).json({ error: err.message, debugLogs: dbg.getLogs() });
  }
});

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

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 Listening on http://localhost:${PORT}`));
}

module.exports = app;
