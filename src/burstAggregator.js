export const BUCKET_MS = 1000;

let hiddenCount = 0;
const buckets = new Map();
let onEmit = () => {};

export function setEmitHandler(fn) {
  onEmit = typeof fn === 'function' ? fn : () => {};
}

export function getHiddenCount() {
  return hiddenCount;
}

export function resetAggregator() {
  for (const b of buckets.values()) clearTimeout(b.timer);
  buckets.clear();
  hiddenCount = 0;
}

function flush(key) {
  const b = buckets.get(key);
  if (!b) return;
  buckets.delete(key);
  clearTimeout(b.timer);

  const notional = b.total;
  if (notional >= 25_000) {
    const price = b.vwapNumer / b.total;
    const row = {
      trader: b.trader,
      side: b.side,
      notional: Math.round(notional),
      price: +(price.toFixed(2)),
      time: new Date().toLocaleTimeString('en-US', { hour12: false }),
      weight: b.weight,
      bias: b.bias
    };
    onEmit(row);
  } else {
    hiddenCount++;
  }
}

export function handleFill(fill) {
  const key = fill.trader.toLowerCase() + '|' + fill.side;
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = {
      trader: fill.trader,
      side: fill.side,
      weight: fill.weight,
      bias: fill.bias,
      total: 0,
      vwapNumer: 0,
      timer: setTimeout(() => flush(key), BUCKET_MS)
    };
    buckets.set(key, bucket);
  }
  bucket.total += fill.notional;
  bucket.vwapNumer += fill.notional * fill.price;
}

export function flushAll() {
  for (const key of Array.from(buckets.keys())) flush(key);
}
