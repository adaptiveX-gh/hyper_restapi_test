/*───────────────────────────────────────────────────────────────*
 *  perpDataFeed – front-end WS multiplexer                      *
 *  Feeds:
 *     • activeAssetCtx(BTC)  → OI / Funding / MarkPx (≤1 s)     *
 *     • candle(BTC, 1m)      → rollingVolume (1 m)              *
 * Perfect for bias lines, bull/bear meters, etc.                *
 *───────────────────────────────────────────────────────────────*/
const URL = 'wss://api.hyperliquid.xyz/ws';
const sock = new WebSocket(URL);

const listeners = { ctx: new Set(), candle: new Set() };

export function onCtx      (fn) { listeners.ctx.add(fn); }
export function onCandle   (fn) { listeners.candle.add(fn); }
export function offCtx     (fn) { listeners.ctx.delete(fn); }
export function offCandle  (fn) { listeners.candle.delete(fn); }

sock.addEventListener('open', () => {
  // ① OI / Funding / MarkPx, pushed tick-by-tick
  sock.send(JSON.stringify({
    method: 'subscribe',
    subscription: { type: 'activeAssetCtx', coin: 'BTC' }
  }));
  // ② One-minute candles for rolling vol; sum 8 for 8 h if you need it
  sock.send(JSON.stringify({
    method: 'subscribe',
    subscription: { type: 'candle', coin: 'BTC', interval: '1m' }
  }));
});

sock.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data);
  const sub  = msg.subscription?.type;

  if (sub === 'activeAssetCtx') {
    /* tolerate both ctx wrappers and flat payloads */
    const ctx = msg.data?.ctx ?? msg.data ?? {};

    const openInterest = ctx.openInterest ?? ctx.oi;
    const funding      = ctx.funding;
    const markPx       = ctx.markPx ?? ctx.markPrice;
    const midPx        = ctx.midPx  ?? ctx.midPrice;
    const oraclePx     = ctx.oraclePx ?? ctx.oraclePrice;

    listeners.ctx.forEach(fn => fn({
      openInterest : Number(openInterest),
      funding      : Number(funding),
      markPx       : Number(markPx),
      midPx        : Number(midPx),
      oraclePx     : Number(oraclePx),
      ts           : Date.now()
    }));
  } else if (sub === 'candle') {
    const last = Array.isArray(msg.data) ? msg.data.at(-1) : msg.data;
    if (last) listeners.candle.forEach(fn => fn(last));
  }
});
