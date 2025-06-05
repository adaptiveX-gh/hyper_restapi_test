const CACHE_TTL   = 300;          // ms – serve cached snapshot < 300 ms old
const RETRY_BACK  = 1000;         // back-off 1 s after a 429
let   lastFetch   = 0;
let   inFlight    = null;
let   cachedBook  = null;
let   backoffTill = 0;

export async function getL2BookThrottled(symbol, depth = 40) {
  const now = Date.now();

  // still backing off from rate-limit hit?
  if (now < backoffTill && cachedBook) return cachedBook;

  // serve cache if still fresh
  if (now - lastFetch < CACHE_TTL && cachedBook) return cachedBook;

  // reuse the same promise if one fetch already running
  if (inFlight) return inFlight;

  const url = `/books/${symbol}?depth=${depth}`;
  inFlight = fetch(url, { cache: 'no-store' })
    .then(r => {
       if (r.status === 429) {
          backoffTill = Date.now() + RETRY_BACK;
          throw new Error('rate-limited');
       }
       return r.json();
    })
    .then(json => {
       cachedBook = json;
       lastFetch  = Date.now();
       return cachedBook;
    })
    .catch(err => {
       console.warn('[getL2Book]', err.message);
       return cachedBook;               // safest fallback
    })
    .finally(() => inFlight = null);

  return inFlight;
}
