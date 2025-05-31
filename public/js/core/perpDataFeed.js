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
    const { openInterest, funding, markPx } = msg.data.ctx;
    listeners.ctx.forEach(fn => fn({ openInterest:+openInterest,
                                     funding:+funding,
                                     markPx:+markPx,
                                     ts:Date.now() }));
  } else if (sub === 'candle') {
    const last = msg.data.at(-1);          // last candle in the batch
    listeners.candle.forEach(fn => fn(last));
  }
});
