/* ------------------------------------------------------------
 *  throttle.js – single request queue shared by all widgets
 * ------------------------------------------------------------*/
const MIN_DELAY   = 30_000;   // 30 s
const MAX_DELAY   = 5*60_000; // 5 min
let   delay       = MIN_DELAY;
let   timer       = null;
let   lastPayload = null;
const cbSet       = new Set();

async function poll() {
  try {
    const res = await fetch("https://api.hyperliquid.xyz/info", {
      method : "POST",
      headers: { "Content-Type":"application/json" },
      body   : JSON.stringify({ type: "perpetuals" })
    });

    if (!res.ok) throw res;        // drive catch{}
    delay = MIN_DELAY;             // success → reset back-off
    lastPayload = await res.json();
    cbSet.forEach(cb => cb(lastPayload));

  } catch {
    delay = Math.min(delay*2, MAX_DELAY);   // exponential back-off
  }

  /* (+/- 2 s) jitter so many tabs don’t sync-up */
  const jitter = (Math.random()*4_000 - 2_000);
  clearTimeout(timer);
  timer = setTimeout(poll, delay + jitter);
}

/* public api --------------------------------------------------*/
export function subscribe(cb){
  cbSet.add(cb);
  if (lastPayload) cb(lastPayload); // immediate first paint
  if (!timer) poll();               // first subscriber kicks it off
}

export function unsubscribe(cb){ cbSet.delete(cb); }
