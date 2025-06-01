/**
 * Classify order-book imbalance ratio relative to 1.0.
 * @param {number} ratio    bid/ask depth ratio
 * @param {number} neutral  half-width of neutral band
 * @returns {'bull'|'bear'|'flat'}
 */
export function classifyObi (ratio, neutral = 0.07) {
  if (typeof ratio !== 'number' || Number.isNaN(ratio)) return 'flat';
  const delta = ratio - 1;
  if (Math.abs(delta) <= neutral) return 'flat';
  return delta > 0 ? 'bull' : 'bear';
}
