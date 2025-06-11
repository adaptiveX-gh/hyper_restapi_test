import { RollingBias } from './rollingBias.js';

export function depthDiff(a, b) {
  const map = arr => new Map(arr.map(([p, s]) => [+p, +s]));
  const [aB, bB, aA, bA] = [map(a.bids), map(b.bids), map(a.asks), map(b.asks)];
  let bidEaten = 0, askEaten = 0;
  for (const [p, s] of aB) bidEaten += Math.max(0, s - (bB.get(p) || 0));
  for (const [p, s] of aA) askEaten += Math.max(0, s - (bA.get(p) || 0));
  return { bidEaten, askEaten };
}

export function classifyTrade(trade, preBook, postBook) {
  const notional = Math.abs(+trade.sz) * +trade.px;
  const { bidEaten, askEaten } = depthDiff(preBook, postBook);
  const type = bidEaten + askEaten > 0 ? 'absorption' : 'exhaustion';
  const SIDE_MAP = { A: 'buy', B: 'sell', S: 'sell' };
  const side = SIDE_MAP[trade.side] || trade.side;

  let visibleDepth = 0;
  if (type === 'absorption') {
    const sideArr = side === 'buy' ? preBook.asks : preBook.bids;
    const lvl = sideArr.find(([px]) => +px === +trade.px);
    if (lvl) visibleDepth = lvl[1] * +trade.px;
  }
  const iceberg = type === 'absorption' && notional > visibleDepth;

  return {
    ts: Date.now(),
    type,
    side,
    notional,
    price: +trade.px,
    bidEaten,
    askEaten,
    iceberg,
    visibleDepth
  };
}

export class TapeFlowAnalyzer {
  constructor(biasWindow = 50) {
    this.bias = new RollingBias(biasWindow);
  }
  process(trade, preBook, postBook) {
    const event = classifyTrade(trade, preBook, postBook);
    this.bias.push(event.type, event.side);
    console.log('[tape]', JSON.stringify(event));
    return event;
  }
  getBias() {
    return this.bias.value();
  }
}
