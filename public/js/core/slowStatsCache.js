/*───────────────────────────────────────────────────────────────*
 *  Slow-lane Stat Cache – OI / Funding / 24 h Vol               *
 *  – refreshed every 30 s with one cheap REST call              *
 *───────────────────────────────────────────────────────────────*/
import axios from 'axios';
import EventEmitter from 'events';

class SlowStatsCache extends EventEmitter {
  #stats = { ts: 0, oi: 0, funding: 0, vol24h: 0 };
  #interval;

  start () {
    this.#fetch();                          // prime immediately
    this.#interval = setInterval(() => this.#fetch(), 30_000);
  }
  stop () { clearInterval(this.#interval); }

  get current () { return this.#stats; }

  async #fetch () {
    try {
      const { data } = await axios.post('https://api.hyperliquid.xyz/info', {
        type: 'metaAndAssetCtxs'
      });
      const btcCtx = data[1].find(ctx => ctx.coin === 'BTC');
      this.#stats = {
        ts: Date.now(),
        oi:        +btcCtx.openInterest,
        funding:   +btcCtx.funding,       // hourly rate – multiply ×8 on the UI
        vol24h:    +btcCtx.dayNtlVlm
      };
      this.emit('update', this.#stats);
    } catch (err) {
      console.error('[SlowStats] fetch failed', err.message);
    }
  }
}

export const slowStatsCache = new SlowStatsCache();
