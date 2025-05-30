/*───────────────────────────────────────────────────────────────*
 *  utils/liquidityWatcher.js
 *  Keeps two micro-liquidity metrics up-to-date:
 *    · RLI – Real-time Liquidity Index  (depth10 / 30-day median)
 *    · LaR – Liquidity-at-Risk          (depth10 / realised σ)
 *
 *  It colours a tiny pill (<span>) and toggles .thin-liq on
 *  an overlay container when books are dangerously thin.
 *
 *  Export:  startLiquidityWatcher(options)     →  stop() fn
 *───────────────────────────────────────────────────────────────*/

const DEPTH_WINDOW_BPS = 10;            // ±10 bps around mid
const BASE_POLL_MS     = 2_000;         // normal cadence
const BACKOFF_MAX_MS   = 60_000;        // cap when proxy sick
const MAX_TRADES_MS    = 5 * 60_000;    // 5-min σ window

export function startLiquidityWatcher({
  symbolInput,          // <input> that holds “BTC-PERP”, “ETH-PERP” …
  pillEl,               // <span>   coloured traffic-light
  overlayTarget = document.body   // gets .thin-liq when LaR low
}) {
  /* ── state ─────────────────────────────────────────────── */
  let running        = true;
  let depthMedian30d = 0;              // refreshed on symbol change
  let tradeBuf       = [];             // rolling 5-min price prints
  let lastSymbol     = norm(symbolInput.value || 'BTC-PERP');

  /* ── helpers ───────────────────────────────────────────── */
  function norm(raw = '') {
    return raw.trim().toUpperCase().replace(/-PERP$/, '') + '-PERP';
  }

  async function fetch30dMedian(sym) {
    try {
      const j = await fetch(`/api/liquidity-median/${sym}`).then(r => r.json());
      return +j.medianDepth10k || 0;
    } catch {
      return 0;
    }
  }

  function realisedSigma() {
    if (tradeBuf.length < 12) return 0;      // need a few points
    const rets = [];
    for (let i = 1; i < tradeBuf.length; i++) {
      rets.push(Math.log(tradeBuf[i].px / tradeBuf[i - 1].px));
    }
    const μ = rets.reduce((a, b) => a + b, 0) / rets.length;
    const var_ = rets.reduce((a, b) => a + (b - μ) ** 2, 0) / rets.length;
    return Math.sqrt(var_);
  }

  /* ── main polling loop ─────────────────────────────────── */
  async function loop(delay = BASE_POLL_MS, misses = 0) {
    if (!running) return;

    /* detect coin switch (user typed new symbol) */
    const symRaw = symbolInput.value || 'BTC-PERP';
    const sym    = norm(symRaw);
    if (sym !== lastSymbol) {
      lastSymbol     = sym;
      tradeBuf       = [];
      depthMedian30d = await fetch30dMedian(sym);
    }

    try {
      /* 1 ░ snapshot top 40 levels ------------------------ */
      const r = await fetch(
        `/books/${encodeURIComponent(sym)}?depth=40`,
        { cache: 'no-store' }
      );
      if (!r.ok) throw new Error('proxy ' + r.status);
      const { bids, asks } = await r.json();

      /* 2 ░ mid-price & depth inside ±10 bps -------------- */
      const mid  = (+bids[0][0] + +asks[0][0]) / 2;
      const band = mid * DEPTH_WINDOW_BPS / 10_000;
      const depth10 = [...bids, ...asks]
        .filter(([px]) => Math.abs(px - mid) <= band)
        .reduce((s, [px, sz]) => s + px * sz, 0);

      /* 3 ░ realised σ  (roll 5 min) ---------------------- */
      const now = Date.now();
      tradeBuf = tradeBuf.filter(t => now - t.ts < MAX_TRADES_MS);
      tradeBuf.push({ ts: now, px: mid });
      const sigma = realisedSigma();

      /* 4 ░ metrics --------------------------------------- */
      const RLI = depthMedian30d ? depth10 / depthMedian30d : 0;
      const LaR = sigma ? depth10 / sigma : 0;
      window.__RLI = RLI;
      window.__LaR = LaR;

      /* 5 ░ colour pill ----------------------------------- */
      const spread = (+asks[0][0] - +bids[0][0]) / mid;
      pillEl.style.background =
        RLI > 1 && spread < 0.0002 ? '#4dff88' :        // plenty & tight
        RLI < 0.3                ? '#ff4d4d' :          // desert
                                    '#ffbe55';          // mid (amber)

      overlayTarget.classList.toggle(
        'thin-liq',
        depthMedian30d && LaR < depthMedian30d * 0.3
      );

      /* 6 ░ healthy → reset cadence ----------------------- */
      delay  = BASE_POLL_MS;
      misses = 0;

    } catch (err) {
      console.warn('[liqWatch]', err.message);
      /* grey pill so UI shows watcher is “blind” */
      pillEl.style.background = '#666';
      /* back-off exponentially up to 60 s */
      misses++;
      delay = Math.min(BACKOFF_MAX_MS, BASE_POLL_MS * 2 ** misses);
    }

    setTimeout(() => loop(delay, misses), delay);
  }
  loop();                         // kick-off

  /* ── disposer for page unload / symbol picker swap ────── */
  return () => { running = false; };
}
