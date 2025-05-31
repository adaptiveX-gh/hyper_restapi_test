/**
 * sheetHelper.js – Google-Sheet helper
 * ------------------------------------
 * Pulls trader wallet addresses (and stats) from a *public* Google Sheet.
 *
 *  • Wallet URL       – column C (index 2)
 *  • Total PnL (USD)  – column D (index 3)
 *  • Win-rate (%)     – column E (index 4)
 *  • Duration (e.g. "297h 37m") – column F (index 5)
 *
 * When you only care about the addresses, call it like:
 *     const wallets = await fetchTraderAddresses();          // ⇢ [ '0xabc…', '0xdef…', … ]
 *
 * To filter:
 *     const highWin   = await fetchTraderAddresses({ winRateMin: 65 });
 *     const longHolds = await fetchTraderAddresses({ durationMinMs: 14 * 24*60*60*1000 });
 *
 * If you also need the stats, pass `{ withStats: true }`.
 */

import axios from 'axios';

/*───────────────────────────────────────────────────────────────*/
/*  Environment                                                 */
/*───────────────────────────────────────────────────────────────*/
const GS_ID  = process.env.GS_ID;            // Google-Sheet ID  (required)
const GS_GID = process.env.GS_GID || '0';    // Tab “gid”        (default first)

/*───────────────────────────────────────────────────────────────*/
/*  Helpers                                                     */
/*───────────────────────────────────────────────────────────────*/
/** Convert "297h 37m" to milliseconds */
export function parseDuration(str = '') {
  const h = +(str.match(/([0-9]+)h/)?.[1] || 0);
  const m = +(str.match(/([0-9]+)m/)?.[1] || 0);
  return (h * 3600 + m * 60) * 1000;
}

/*───────────────────────────────────────────────────────────────*/
/*  Main fetcher                                                */
/*───────────────────────────────────────────────────────────────*/
/**
 * @typedef {Object} TraderRow
 * @property {string} address      0x-wallet
 * @property {number} pnl          total PnL (USD)
 * @property {number} winRate      win-rate %
 * @property {number} durationMs   holding duration in ms
 */

/**
 * @param {Object}  [filters]
 * @param {number}  [filters.pnlMin]        – minimum PnL (USD)
 * @param {number}  [filters.winRateMin]    – minimum win-rate %
 * @param {number}  [filters.durationMinMs] – minimum holding time (ms)
 * @param {boolean} [filters.withStats]     – if true ⇢ return TraderRow[]
 *
 * @returns {Promise<string[]|TraderRow[]>}
 */
export async function fetchTraderAddresses(filters = {}) {
  if (!GS_ID) throw new Error('Missing environment variable GS_ID (Google-Sheet ID)');

  const csvUrl =
    `https://docs.google.com/spreadsheets/d/${GS_ID}/gviz/tq?tqx=out:csv&gid=${GS_GID}`;

  /* download the sheet as CSV */
  const { data: csv } = await axios.get(csvUrl, { timeout: 10_000 });
  const rows = csv.trim().split(/\r?\n/).slice(1);      // skip header

  const out = [];
  for (const row of rows) {
    /* naïve CSV-split (fine for simple sheets) */
    const cols = row.split(',');

    /* Column indexes (0-based)  :  C ⇒ 2,  D ⇒ 3, … */
    const urlField     = (cols[2] || '').replace(/^"|"$/g, '').trim();
    const pnlField     = (cols[3] || '0').replace(/"/g, '');
    const winRateField = (cols[4] || '0').replace(/[^0-9.]/g, '');
    const durField     = (cols[5] || '');

    /* extract wallet address from the URL */
    const match = urlField.match(/0x[0-9a-fA-F]{40}/);
    if (!match) continue;
    const address = match[0];

    /* parse numeric stats */
    const pnl        = +pnlField     || 0;
    const winRate    = +winRateField || 0;
    const durationMs = parseDuration(durField);

    /* apply filters, if any */
    if (filters.pnlMin        != null && pnl        < filters.pnlMin)         continue;
    if (filters.winRateMin    != null && winRate    < filters.winRateMin)     continue;
    if (filters.durationMinMs != null && durationMs < filters.durationMinMs)  continue;

    if (filters.withStats) {
      out.push({ address, pnl, winRate, durationMs });
    } else {
      out.push(address);
    }
  }

  return out;
}
