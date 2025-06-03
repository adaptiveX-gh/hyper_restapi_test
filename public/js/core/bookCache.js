let lastHit = 0;
let inFlight = null;                 // { promise, abort }
const COOLDOWN_MS = 1500;

export async function getBook(symbol, depth){
  const now = Date.now();
  if (inFlight) return inFlight.promise;          // reuse
  if (now - lastHit < COOLDOWN_MS) return null;   // too soon

  const ctrl = new AbortController();
  const p = fetch(`/books/${symbol}?depth=${depth}`, {
    cache: 'no-store',
    signal: ctrl.signal
  })
    .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
    .finally(() => { inFlight = null; lastHit = Date.now(); });

  inFlight = { promise: p, abort: () => ctrl.abort() };
  return p;
}

export function abortBookFetch(){
  inFlight?.abort(); inFlight = null;
}
