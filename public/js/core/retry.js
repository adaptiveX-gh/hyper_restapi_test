export async function retry(fn, { max = 4, delay = 300 } = {}) {
  let e;
  for (let i = 0; i < max; i++) {
    try { return await fn(); }         // happy path
    catch (err) {
      if (err?.response?.status !== 429) throw err; // not rate-limit
      e = err;
      await new Promise(r => setTimeout(r, delay * (i + 1))); // back-off
    }
  }
  throw e;
}