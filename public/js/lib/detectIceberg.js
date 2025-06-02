export function detectIceberg(trades, side, minNotional = 100000, streak = 3) {
  if (!Array.isArray(trades) || !trades.length) return null;
  let count = 0;
  let mmId = null;
  let total = 0;
  for (let i = trades.length - 1; i >= 0; i--) {
    const t = trades[i];
    if (t.side !== side) break;
    if (t.notional < minNotional) break;
    if (!t.visibleDepth || t.visibleDepth / t.notional > 0.1) break;
    if (mmId == null) {
      mmId = t.mmId;
    } else if (t.mmId !== mmId) {
      break;
    }
    total += t.notional;
    count++;
    if (count >= streak) {
      const avg = total / count;
      const strength = Math.min(avg / minNotional, 1);
      return {
        id: side === 'buy' ? 'iceberg_event_up' : 'iceberg_event_down',
        strength,
        ts: t.ts,
        meta: { mmId, streak: count }
      };
    }
  }
  return null;
}
