import { processTrade, processDepth, snapshot } from '../public/js/core/metricsWorker.js';

describe('metrics worker snapshot', () => {
  beforeEach(() => { global.self = { postMessage: jest.fn() }; });

  test('computes bullPct from trades', () => {
    processTrade({ side:'buy', notional:100000, kind:'absorption', price:100, ts:0 });
    processTrade({ side:'sell', notional:100000, kind:'exhaustion', price:101, ts:0 });
    processDepth({ bidDepth:500000, askDepth:400000, topBid:100, topAsk:101, ts:0 });
    const snap = snapshot();
    expect(snap.bullPct).toBeCloseTo(85, 0);
    expect(snap.bearPct).toBe(0);
  });
});
