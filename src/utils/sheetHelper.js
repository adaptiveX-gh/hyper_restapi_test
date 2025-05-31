/**
 * sheetHelper.js – helper to pull wallet addresses + stats
 * from columns C (URL), D (Total PnL), E (Winrate), F (Duration)
 * of a public Google Sheet. Optionally filters by min PnL, min Winrate,
 * min Duration.
 */


const axios = require('axios');

const GS_ID  = process.env.GS_ID;            // required
const GS_GID = process.env.GS_GID || '0';    // default first sheet tab

/**
 * Parse duration string like "297h 37m" into milliseconds
 */
export function parseDuration(str) {
  const hoursMatch = /([0-9]+)h/.exec(str);
  const minsMatch  = /([0-9]+)m/.exec(str);
  const hours = hoursMatch ? parseInt(hoursMatch[1], 10) : 0;
  const mins  = minsMatch  ? parseInt(minsMatch[1], 10) : 0;
  return (hours * 3600 + mins * 60) * 1000;
}

/**
 * Fetch and optionally filter traders from sheet.
 * @param {{pnlMin?: number, winRateMin?: number, durationMinMs?: number}} [filters]
 * @returns {Promise<Array<{address:string,pnl:number,winRate:number,durationMs:number}>>}
 */
export async function fetchTraderAddresses(filters = {}) {
  if (!GS_ID) throw new Error('Missing GS_ID env var');
  const csvUrl = `https://docs.google.com/spreadsheets/d/${GS_ID}/gviz/tq?tqx=out:csv&gid=${GS_GID}`;

  const { data: csv } = await axios.get(csvUrl, { timeout: 8000 });
  const lines = csv.trim().split(/\r?\n/);
  const rows = lines.slice(1);

  const traders = [];
  for (const row of rows) {
    // simple CSV-split on commas (will break if your fields contain commas…)
    const cols = row.split(',');
    const urlField     = cols[2] || '';
    const pnlField     = cols[3] || '0';
    const winRateField = cols[4] || '0';
    const durField     = cols[5] || '';

    // extract wallet address from the URL column
    const url   = urlField.replace(/^"|"$/g, '').trim();
    const match = url.match(/0x[0-9a-fA-F]{40}/);
    if (!match) continue;
    const address = match[0];

    // parse stats
    const pnl      = parseFloat(pnlField.replace(/"/g, '')) || 0;
    const winRate  = parseFloat(winRateField.replace(/[^0-9.]/g, '')) || 0;
    const durationMs = parseDuration(durField);

    // apply filters
    if (filters.pnlMin        != null && pnl       < filters.pnlMin)        continue;
    if (filters.winRateMin    != null && winRate   < filters.winRateMin)    continue;
    if (filters.durationMinMs != null && durationMs < filters.durationMinMs) continue;

    traders.push({ address, pnl, winRate, durationMs });
  }

  return traders;
}

module.exports = { fetchTraderAddresses };
