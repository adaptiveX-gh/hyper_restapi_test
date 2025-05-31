/*───────────────────────────────────────────────────────────────*
 * SlowStatsCache  –  BTC-PERP OI / Funding / 24-h Volume        *
 * Poll cadence: 30 s                                            *
 * Strategy:                                                     *
 *   1. Try cheap  { type:'assetCtxs', coin:0 }        (weight 5)*
 *   2. On 4xx fallback to { type:'metaAndAssetCtxs' } (weight20)*
 *      + robust mapper that matches BTC no matter the shape.    *
 *───────────────────────────────────────────────────────────────*/
import axios from 'axios';
import EventEmitter from 'events';

class SlowStatsCache extends EventEmitter {
  #stats = { ts: 0, oi: 0, funding: 0, vol24h: 0 };
  #id    = null;

  start () {
    this.#poll();
    this.#id = setInterval(() => this.#poll(), 30_000);
  }
  stop () { clearInterval(this.#id); }
  get current () { return this.#stats; }

  /*───────────────────────────────────────────────────────────*/
  async #poll () {
    try {
      /* ① cheap single-asset query (assetId 0 ⇒ BTC) */
      const r1 = await axios.post(
        'https://api.hyperliquid.xyz/info',
        { type:'assetCtxs', coin:0 },
        { timeout:5_000, validateStatus:s=>true }
      );
      let ctx = (r1.status === 200 && Array.isArray(r1.data)) ? r1.data[0] : null;

      /* ② fallback – heavy query + flexible mapper */
      if (!ctx) {
        const r2 = await axios.post(
          'https://api.hyperliquid.xyz/info',
          { type:'metaAndAssetCtxs' },
          { timeout:8_000 }
        );

        /* detect shapes */
        const assets =
             Array.isArray(r2.data)          ? r2.data[1]          // [meta, assetCtxs]
           : Array.isArray(r2.data?.assetCtxs) ? r2.data.assetCtxs // { assetCtxs:[] }
           : Array.isArray(r2.data?.assets)    ? r2.data.assets    // SDK mirror
           : null;

        const meta =
             Array.isArray(r2.data)          ? r2.data[0]?.universe
           : Array.isArray(r2.data?.universe)  ? r2.data.universe
           : null;

        /* first, trust meta→index mapping if present */
        if (meta && assets && meta.length === assets.length) {
          const idx = meta
            .map(u => (typeof u === 'string' ? u : u.name || u.symbol || '')
              .toUpperCase().replace(/-PERP$/, ''))
            .indexOf('BTC');
          if (idx !== -1) ctx = assets[idx];
        }

        /* fallback search by props */
        if (!ctx && assets) {
          ctx = assets.find(a => {
            const id = (a.coin ?? a.ticker ?? a.name ?? a.symbol ?? '')
              .toString().toUpperCase();
            return id === 'BTC' || id === 'BTC-PERP';
          });
        }
      }

      if (!ctx) throw new Error('BTC context not located');

      /* —— snapshot —— */
      this.#stats = {
        ts     : Date.now(),
        oi     : +ctx.openInterest || 0,
        funding: +ctx.funding      || 0,
        vol24h : +ctx.dayNtlVlm    || 0
      };
      this.emit('update', this.#stats);

    } catch (err) {
      console.warn('[SlowStats] poll failed –', err.message);
      /* keep last good stats; try again next tick */
    }
  }
}

export const slowStatsCache = new SlowStatsCache();
