/**
 * Compact-formats a positive number to “x.x M / B”.
 *  – below 10 000 ➜ no change
 *  – 1 000 000 … 999 999 999 ➜ M
 *  – ≥ 1 000 000 000          ➜ B
 * Always rounds **half-up** to one decimal.
 *
 * @param {number} n
 * @returns {string} e.g. "1.0 M", "2.3 B", "9 876"
 */
export function formatCompact(n) {
  if (!Number.isFinite(n)) return '—';

  const MILLION = 1_000_000;
  const BILLION = 1_000_000_000;

  if (n < 10_000) return n.toLocaleString();          // keep full digits
  if (n < BILLION) {
    const value = Math.round((n / MILLION) * 10) / 10; // half-up, 1 dp
    return `${value.toFixed(1)} M`;
  }
  const value = Math.round((n / BILLION) * 10) / 10;
  return `${value.toFixed(1)} B`;
}
