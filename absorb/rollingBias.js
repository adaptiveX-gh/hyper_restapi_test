export class RollingBias {
  constructor(windowSize = 50) {
    this.windowSize = Math.max(1, windowSize);
    this.buf = [];
  }

  /**
   * Push a flow event into the rolling window.
   * @param {'absorption'|'exhaustion'} type
   * @param {'buy'|'sell'} side
   */
  push(type, side) {
    let val = 0;
    if (type === 'absorption') {
      val = side === 'buy' ? 1 : -1;
    } else if (type === 'exhaustion') {
      val = side === 'buy' ? 0.3 : -0.3;
    } else {
      return;
    }
    this.buf.push(val);
    if (this.buf.length > this.windowSize) this.buf.shift();
  }

  /**
   * Current rolling bias value (mean of window).
   * @returns {number}
   */
  value() {
    if (!this.buf.length) return 0;
    const sum = this.buf.reduce((s, v) => s + v, 0);
    return sum / this.buf.length;
  }
}
