import bus from './eventBus.js';

const show = new Set([
  'whale','top_trader','absorption','exhaustion',
  'sweep','iceberg','liquidity_flush','bounce',
  'strong_bounce_incoming','liquidity_vacuum_flush',
  'flow_flip_squeeze_up','flow_flip_squeeze_down'
]);

bus.on('qr:event', ev => {
  if (!show.has(ev.kind) || ev.strength < 0.05) return;
  const dir = ev.side === 'buy' ? 'up' : ev.side === 'sell' ? 'down' : '';
  window.radar?.addBubble(ev.kind, {
    ts: ev.ts,
    strength: ev.strength,
    side: dir,
    meta: ev.meta
  });
});
