/*───────────────────────────────────────────────────────────────*
 * SlowStatsCache  –  BTC-PERP OI / Funding / 24-h Volume        *
 * Poll cadence: 30 s                                            *
 * Strategy:                                                     *
 *   1. Cheap  POST { type:'assetCtxs', coin:0 }        (weight 5)
 *   2. 4xx →  POST { type:'metaAndAssetCtxs' }        (weight 20)
 *      + robust mapper that matches BTC in any payload shape.   *
 *───────────────────────────────────────────────────────────────*/
import axios         from 'axios';
import EventEmitter  from 'events';

class SlowStatsCache extends EventEmitter {
  #stats = { ts: 0, oi: 0, oiContracts: 0, funding: 0, vol24h: 0 };
  #id    = null;

  start () {
    this.#poll();                             // prime immediately
    this.#id = setInterval(() => this.#poll(), 30_000);
  }
  stop ()            { clearInterval(this.#id);      }
  get current ()     { return this.#stats;            }

  /*───────────────────────────────────────────────────────────*/
  async #poll () {
    try {
    /* ── ① Light-weight single-asset query (assetId 0 == BTC) ── */
      const r1 = await axios.post(
        'https://api.hyperliquid.xyz/info',
        { type: 'assetCtxs', coin: 0 },
        { timeout: 5_000, validateStatus: s => true }
      );
      let ctx = (r1.status === 200 && Array.isArray(r1.data)) ? r1.data[0] : null;

    /* ── ② Heavy fallback with shape-agnostic BTC locator ─────── */
      if (!ctx) {
        const r2 = await axios.post(
          'https://api.hyperliquid.xyz/info',
          { type: 'metaAndAssetCtxs' },
          { timeout: 8_000 }
        );

        /* tolerate every shape Hyperliquid has shipped so far */
        const assets =
             Array.isArray(r2.data)            ? r2.data[1]          // [meta, assetCtxs]
           : Array.isArray(r2.data?.assetCtxs) ? r2.data.assetCtxs   // { assetCtxs:[] }
           : Array.isArray(r2.data?.assets)    ? r2.data.assets      // SDK mirror
           : null;

        const meta =
             Array.isArray(r2.data)            ? r2.data[0]?.universe
           : Array.isArray(r2.data?.universe)  ? r2.data.universe
           : null;

        /* a) prefer the universe→index mapping if present */
        if (meta && assets && meta.length === assets.length) {
          const idx = meta
            .map(u => (typeof u === 'string' ? u : u.name || u.symbol || '')
              .toUpperCase().replace(/-PERP$/, ''))
            .indexOf('BTC');
          if (idx !== -1) ctx = assets[idx];
        }

        /* b) brute-force search by id properties */
        if (!ctx && assets) {
          ctx = assets.find(a => {
            const id = (a.coin ?? a.ticker ?? a.name ?? a.symbol ?? '')
              .toString().toUpperCase();
            return id === 'BTC' || id === 'BTC-PERP';
          });
        }
      }

      if (!ctx) throw new Error('BTC context not located');

    /* ── ③  Compose the snapshot  ─────────────────────────────── */
      const oiContracts = +ctx.openInterest || 0;
      // pick whichever price the ctx carries; markPx preferred
      const px = +ctx.markPx || +ctx.midPx || +ctx.oraclePx || 0;
      const oiUsd = oiContracts * px;

      this.#stats = {
        ts          : Date.now(),
        oi          : oiUsd,        // <-- USD notional (for your dashboard tile)
        oiContracts,               //   raw contracts if you still need them
        funding     : +ctx.funding   || 0,
        vol24h      : +ctx.dayNtlVlm || 0
      };

      this.emit('update', this.#stats);

    } catch (err) {
      console.warn('[SlowStats] poll failed –', err.message);
      /* keep last good stats; will retry next tick */
    }
  }
}

/* export singleton */
export const slowStatsCache = new SlowStatsCache();
