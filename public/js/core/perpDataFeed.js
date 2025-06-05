/*───────────────────────────────────────────────────────────────*
 *  perpDataFeed – front-end WS multiplexer                      *
 *  Feeds:
 *     • activeAssetCtx(BTC)  → OI / Funding / MarkPx (≤1 s)     *
 *     • candle(BTC, 1m)      → rollingVolume (1 m)              *
 * Perfect for bias lines, bull/bear meters, etc.                *
 *───────────────────────────────────────────────────────────────*/
const URL = 'wss://api.hyperliquid.xyz/ws';
let sock = null;
let activeCoin = 'BTC';

const listeners = { ctx: new Set(), candle: new Set() };

export function onCtx      (fn) { listeners.ctx.add(fn); }
export function onCandle   (fn) { listeners.candle.add(fn); }
export function offCtx     (fn) { listeners.ctx.delete(fn); }
export function offCandle  (fn) { listeners.candle.delete(fn); }

function subscribe () {
  if (!sock || sock.readyState !== WebSocket.OPEN) return;
  sock.send(JSON.stringify({
    method: 'subscribe',
    subscription: { type: 'activeAssetCtx', coin: activeCoin }
  }));
  sock.send(JSON.stringify({
    method: 'subscribe',
    subscription: { type: 'candle', coin: activeCoin, interval: '1m' }
  }));
}

function handleMessage(ev){
  const msg = JSON.parse(ev.data);
  const sub  = msg.subscription?.type;

  if (sub === 'activeAssetCtx') {
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
}

export function connect(coin = 'BTC') {
  activeCoin = coin.toUpperCase().replace(/-PERP$/, '');
  if (sock) {
    try { sock.close(1000, 'reconnect'); } catch {}
  }
  sock = new WebSocket(URL);
  sock.addEventListener('open', subscribe);
  sock.addEventListener('message', handleMessage);
}

export function setCoin(coin){
  activeCoin = coin.toUpperCase().replace(/-PERP$/, '');
  if (!sock) return connect(activeCoin);
  try { sock.close(1000, 'change coin'); } catch {}
  connect(activeCoin);
}
