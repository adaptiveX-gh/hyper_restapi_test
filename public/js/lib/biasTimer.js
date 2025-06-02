export class BiasTimer {
  #displayId;
  #sign = 0;
  #start = Date.now();
  #interval = null;

  constructor(displayId = 'biasRollTimer') {
    this.#displayId = displayId;
    this.#load();
  }

  #load() {
    const saved = localStorage.getItem('biasTimer');
    if (!saved) return;
    try {
      const obj = JSON.parse(saved);
      if (typeof obj.sign === 'number') this.#sign = obj.sign;
      if (typeof obj.start === 'number') this.#start = obj.start;
    } catch { /* ignore */ }
  }

  #save() {
    localStorage.setItem('biasTimer', JSON.stringify({
      sign: this.#sign,
      start: this.#start
    }));
  }

  #formatSecs(secs) {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  #tick = () => {
    const el = document.getElementById(this.#displayId);
    if (!el) return;
    const secs = Math.floor((Date.now() - this.#start) / 1000);
    el.textContent = this.#formatSecs(secs);
  };

  start() {
    this.#tick();
    clearInterval(this.#interval);
    this.#interval = setInterval(this.#tick, 1000);
  }

  stop() {
    clearInterval(this.#interval);
    this.#interval = null;
  }

  update(biasVal) {
    const sign = biasVal > 0 ? 1 : biasVal < 0 ? -1 : 0;
    if (sign !== this.#sign) {
      this.#sign = sign;
      this.#start = Date.now();
      this.#save();
    }
  }

  elapsedSeconds() {
    return Math.floor((Date.now() - this.#start) / 1000);
  }
}
