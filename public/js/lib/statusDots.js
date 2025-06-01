/* ============================================================================
 *  Status-dot helpers  –  PRD #8
 *  ========================================================================== */

const COLOURS = {
  bull   : '#28c76f',           // OI & Funding   → Bullish
  bear   : '#ff5252',           // OI & Funding   → Bearish
  strong : '#28c76f',           // Liquidity/Vol  → Strong
  weak   : '#ff5252',           // Liquidity/Vol  → Weak
  normal : '#9e9e9e',           // neutral grey   → Normal / Flat
  flat   : '#9e9e9e'
};

/* ------------------------------------------------------- */
/* 1.  OI + Funding classifier                             */
/* ------------------------------------------------------- */
export function stateOiFunding ({ dOi, funding }) {
  if (dOi > 0 && funding < 0) return 'bull';
  if (dOi < 0 || funding > 0) return 'bear';
  return 'flat';
}

/* ------------------------------------------------------- */
/* 2.  Strength classifier  (Liquidity & Volume)           */
/* ------------------------------------------------------- */
export function stateStrength ({ pctVsMedian }) {
  if (pctVsMedian >= 0.25)  return 'strong';     // ≥ +25 %
  if (pctVsMedian <= -0.25) return 'weak';       // ≤ −25 %
  return 'normal';
}

/* ------------------------------------------------------- */
/* 3.  Utility – paint one dot + tooltip                   */
/* ------------------------------------------------------- */
export function paintDot(el, state, tooltip = '') {
  if (!el) return;                       // --- guard → no more TypeError
  el.className = 'status-dot ' + state;  // add / replace colour class
  el.title     = tooltip;
}
