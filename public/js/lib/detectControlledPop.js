export function detectControlledPop(imbArr, confArr, sigma, window = 4) {
  if (!Array.isArray(imbArr) || !Array.isArray(confArr)) return null;
  if (imbArr.length < window || confArr.length < window) return null;
  const imbWindow = imbArr.slice(-window);
  const confWindow = confArr.slice(-window);

  const controlled = imbWindow.every(d => d.value < sigma && d.value > 0);
  const confOk = confWindow.every(d => d.value <= 0);

  if (!controlled || !confOk) return null;

  const minAbs = Math.min(...imbWindow.map(d => Math.abs(d.value)));
  const strength = 1 - Math.min(minAbs / sigma, 1);
  const ts = imbWindow[imbWindow.length - 1].ts;
  return {
    id: 'controlled_pop',
    strength: Math.max(0, Math.min(strength, 1)),
    ts,
    meta: { imbWindow, confWindow, sigma }
  };
}
