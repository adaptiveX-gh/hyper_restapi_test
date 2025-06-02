import { detectIceberg } from '../public/js/lib/detectIceberg.js';

describe('detectIceberg', () => {
  test('returns signal when streak met', () => {
    const now = Date.now();
    const trades = [
      { mmId: 'MM1', side: 'buy', notional: 120000, visibleDepth: 5000, ts: now - 3000 },
      { mmId: 'MM1', side: 'buy', notional: 110000, visibleDepth: 8000, ts: now - 2000 },
      { mmId: 'MM1', side: 'buy', notional: 150000, visibleDepth: 5000, ts: now - 1000 }
    ];
    const res = detectIceberg(trades, 'buy', 100000, 3);
    expect(res).not.toBeNull();
    expect(res.id).toBe('iceberg_event_up');
    expect(res.strength).toBeGreaterThan(0);
  });

  test('returns null when mmId differs', () => {
    const now = Date.now();
    const trades = [
      { mmId: 'MM1', side: 'sell', notional: 120000, visibleDepth: 5000, ts: now - 2000 },
      { mmId: 'MM2', side: 'sell', notional: 130000, visibleDepth: 5000, ts: now - 1000 },
      { mmId: 'MM1', side: 'sell', notional: 140000, visibleDepth: 5000, ts: now }
    ];
    const res = detectIceberg(trades, 'sell', 100000, 3);
    expect(res).toBeNull();
  });
});
