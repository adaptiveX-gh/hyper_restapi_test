/* core/api.js
   ────────────
   Minimal fetch helpers for the browser-side app.
   All functions return **parsed JSON** or throw if the request fails.
*/

/* ---------- generic helpers --------------------------------------- */

/** GET a JSON end-point. */
export async function getJson (url) {
  const res = await fetch(url);
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${msg}`);
  }
  return res.json();
}

/** POST a JSON body and get JSON back. */
export async function postJson (url, body = {}) {
  const res = await fetch(url, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify(body)
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${msg}`);
  }
  return res.json();
}

export const postJSON = postJson;   // ← alias for compatibility


/* ---------- specific helper used by many strategy panes ----------- */

/**
 * Fetches trader addresses from the server’s Google-Sheet helper.
 * @param {Object} filters  { pnlMin, winRateMin, durationMin } – each optional
 * @returns {Promise<string[]>}  array of wallet addresses
 */
export async function loadSheetAddresses (filters = {}) {
  const params = new URLSearchParams();

  if (filters.pnlMin      != null) params.append('pnlMin',       filters.pnlMin);
  if (filters.winRateMin  != null) params.append('winRateMin',   filters.winRateMin);
  if (filters.durationMin != null) {
    // UI supplies *hours*; API expects milliseconds
    const ms = Number(filters.durationMin) * 60 * 60 * 1000;
    if (!Number.isNaN(ms)) params.append('durationMin', ms);
  }

  const url  = '/api/traderAddresses' + (params.toString() ? `?${params}` : '');
  const data = await getJson(url);

  /* server returns either [{ address:"0x…" }, …] or plain string[] */
  return Array.isArray(data)
    ? (typeof data[0] === 'string' ? data : data.map(o => o.address))
    : [];
}


/**
 * POST JSON and return the **raw Response** so callers can stream.
 * It still throws on non-2xx like the other helpers.
 */
export async function postStream (url, body = {}) {
  const res = await fetch(url, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify(body)
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${msg}`);
  }
  return res;                 // ⚠️  untouched stream
}