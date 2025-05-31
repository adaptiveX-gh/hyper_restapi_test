/* ------------------------------------------------------------------
 *  livePerpStatsWS.js – connect once, broadcast to anyone listening
 * ------------------------------------------------------------------ */
const HL_WS = "wss://api.hyperliquid.xyz/ws";

export class PerpStatsFeed {
  constructor(sym) {
    this.sym = sym.replace("-PERP", "");      // e.g. “BTC”
    this.sock = null;
    this.callbacks = new Set();
    this.connect();
  }

  connect() {
    this.sock = new WebSocket(HL_WS);

    this.sock.onopen = () => {
      this.sock.send(
        JSON.stringify({ type: "perpStats", symbols: [this.sym] })
      );
    };

    this.sock.onmessage = e => {
      const m = JSON.parse(e.data);
      if (!m?.perpStats) return;

      /* { symbol, volume24h, openInterest, fundingRate8h, … } */
      const s = m.perpStats[0];
      this.callbacks.forEach(cb => cb(s));
    };

    /* naïve reconnect w/ expo-back-off */
    this.sock.onclose = () => {
      setTimeout(() => this.connect(), 3_000);
    };
  }

  /* register UI subscribers */
  on(cb) { this.callbacks.add(cb); }

  off(cb){ this.callbacks.delete(cb); }
}
