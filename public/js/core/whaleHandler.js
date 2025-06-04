export function handleWhaleAnomaly(radar, data) {
  if (!radar || !data || data.type !== 'anomaly') return;
  const p = data.payload || {};
  if (p.kind === 'mega_whale_up' || p.kind === 'mega_whale_down' ||
      p.kind === 'baby_whale_up' || p.kind === 'baby_whale_down') {
    radar.addBubble(p.kind, { ts: p.ts, strength: p.strength });
  }
}
