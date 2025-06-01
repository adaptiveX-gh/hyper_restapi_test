/*───────────────────────────────────────────────────────────────*\
  rollingStats.js – windowed descriptive statistics helper
  • 100 % dependency-free, ES-module friendly
  • Accepts only finite numbers – silently drops anything else
  • O(n log n) pct / median (safe for n ≤ 1 000); O(1) push.
\*───────────────────────────────────────────────────────────────*/

export class RollingStats {
  /**
   * @param {number} size  maximum observations to keep (FIFO)
   */
  constructor (size = 300) {
    this.size = Math.max(1, size);
    this.buf  = [];
  }

  /**
   * Add a new observation.
   * Non-finite values (undefined, null, NaN, '', Infinity …)
   * are ignored so they cannot pollute subsequent statistics.
   *
   * @param {number} x
   */
  push (x) {
    const v = Number(x);

    /* ── HARD GATE: only finite numbers are accepted ───────── */
    if (!Number.isFinite(v)) return;

    this.buf.push(v);
    if (this.buf.length > this.size) this.buf.shift();
  }

  /*──────── derived statistics (computed on demand) ────────*/

  /** sorted defensive clone – internal helper */
  _sorted () {
    // slice() to clone – never mutate the live buffer!
    return this.buf.slice().sort((a, b) => a - b);
  }

  /**
   * @returns {number} median of current window
   */
  median () {
    if (!this.buf.length) return 0;

    const s = this._sorted();
    const mid = s.length >> 1;               // ⌊n / 2⌋

    return s.length & 1
      ? s[mid]                               // odd length → middle
      : 0.5 * (s[mid - 1] + s[mid]);         // even → mean of middle pair
  }

  /**
   * @returns {number} mean of current window
   */
  mean () {
    return this.buf.length
      ? this.buf.reduce((sum, x) => sum + x, 0) / this.buf.length
      : 0;
  }

  /**
   * @returns {number} population standard deviation (σ)
   */
  std () {
    if (!this.buf.length) return 0;

    const μ = this.mean();
    const varPop = this.buf.reduce((s, x) => s + (x - μ) ** 2, 0) /
                   this.buf.length;

    return Math.sqrt(varPop);
  }

  /**
   * Percentile –  q ∈ [0, 1]  (e.g. q = 0.9 → 90-th pct)
   *
   * @param {number} q
   * @returns {number}
   */
  pct (q) {
    if (!this.buf.length) return 0;

    const s = this._sorted();
    const idx = Math.min(
      Math.max(Math.floor(q * s.length), 0),
      s.length - 1
    );

    return s[idx];
  }

  /*──── convenience getters ────*/

  get count () { return this.buf.length; }
  clear ()     { this.buf.length = 0; }
}
