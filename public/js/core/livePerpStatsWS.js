// livePerpStatsWS.js (excerpt)
export class PerpStatsFeed {
  constructor(sym) {
    this.sym      = sym;
    this.retries  = 0;
    this.maxDelay = 30_000;          // cap at 30 s
    this.connect();
  }

  connect() {
    this.ws = new WebSocket("wss://api.hyperliquid.xyz/ws");

    this.ws.onopen    = () => { this.retries = 0; this.subscribe(); };
    this.ws.onmessage = (ev) => this.handle(JSON.parse(ev.data));
    this.ws.onclose   = () => this.reopen();
    this.ws.onerror   = () => this.ws.close();   // force onclose → reopen
  }

  reopen() {
    const delay = Math.min(1000 * 2 ** this.retries, this.maxDelay);
    setTimeout(() => { this.retries++; this.connect(); }, delay);
  }

  subscribe() {
    const msg = { method: "subscribe",
                  subscription: { type: "perpStats", coin: this.sym } };
    this.ws.send(JSON.stringify(msg));
  }
}
