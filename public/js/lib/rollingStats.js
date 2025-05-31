/*───────────────────────────────────────────────────────────────*\
  rollingStats.js  –  tiny rolling-window statistics helper
  Exported class is totally dependency-free.
\*───────────────────────────────────────────────────────────────*/

export class RollingStats {
  constructor(size = 300) {
    this.size = size;     // max observations to keep
    this.buf  = [];       // circular buffer
  }

  push(x) {
    this.buf.push(+x);
    if (this.buf.length > this.size) this.buf.shift();
  }

  /* ── descriptive stats on the current window ───────────────── */

  _sorted () { return [...this.buf].sort((a, b) => a - b); }

  median () {
    if (!this.buf.length) return 0;
    const s = this._sorted();
    const m = s.length >> 1;              // floor(len / 2)
    return s.length & 1 ? s[m]            // odd   → middle
                        : 0.5 * (s[m - 1] + s[m]); // even → mean of 2 middles
  }

  mean   () {
    return this.buf.reduce((sum, x) => sum + x, 0) / (this.buf.length || 1);
  }

  std    () {
    const μ = this.mean();
    return Math.sqrt(
      this.buf.reduce((s, x) => s + (x - μ) ** 2, 0) / (this.buf.length || 1)
    );
  }

  pct(q) {                         // q in [0,1] – e.g. 0.9 ⇒ 90-th pct
    if (!this.buf.length) return 0;
    const s = this._sorted();
    return s[Math.floor(q * s.length)];
  }
}
