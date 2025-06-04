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

/**
 * Classify rolling bias value by sign.
 * @param {number} val
 * @returns {'bull'|'bear'|'flat'}
 */
export function classifyBias (val) {
  if (typeof val !== 'number' || Number.isNaN(val) || val === 0) return 'flat';
  return val > 0 ? 'bull' : 'bear';
}

/**
 * Compute the Over-Extension gauge value.
 *
 * @param {object} ctx
 * @param {number} ctx.zPrice       Price distance from VWAP in σ
 * @param {number} ctx.biasSlope15m 15‑min bias-line slope (−1…+1)
 * @param {number} ctx.rsi15m       15‑min RSI (0…100)
 * @returns {number} Normalised gauge reading (−1…+1)
 */
export function computeOverExt({ zPrice = 0, biasSlope15m = 0, rsi15m = 50 } = {}) {
  const z   = zPrice / 2;              // scale 2 σ → 1.0
  const sl  = biasSlope15m;            // already −1…+1
  const rsi = (rsi15m - 50) / 30;      // RSI 80 → +1, 20 → −1
  const v   = (z + sl + rsi) / 3;
  return Math.max(-1, Math.min(1, v));
}

/**
 * Compute Trap meter value signalling exit-liquidity situations.
 *
 * @param {object} ctx
 * @param {number} ctx.confirm    Confirmation gauge value
 * @param {number} ctx.LaR        Liquidity-at-Risk gauge value
 * @param {number} ctx.earlyWarn  Early-Warn gauge value
 * @param {number} ctx.resilience Resilience gauge value
 * @returns {number} Trap score (−1…+1)
 */
export function computeTrap({ confirm = 0, LaR = 1, earlyWarn = 0, resilience = 0 } = {}) {
  const bull = (confirm > 0.25) &&
               (LaR < 0.30) &&
               (earlyWarn < 0) &&
               (resilience < 0);

  const bear = (confirm < -0.25) &&
               (LaR < 0.30) &&
               (earlyWarn > 0) &&
               (resilience > 0);

  return bull ? 1 : bear ? -1 : 0;
}
