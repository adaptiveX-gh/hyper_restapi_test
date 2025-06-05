import { startSnapshotWriter } from '../src/redisSnapshotWriter.js';

class MockRedis {
  constructor() {
    this.store = new Map();
    this.ttl = new Map();
  }
  async set(key, val, opts) {
    this.store.set(key, val);
    if (opts && opts.EX) this.ttl.set(key, opts.EX);
  }
}

describe('redis snapshot writer', () => {
  test('writes valid snapshot and resets TTL', () => {
    jest.useFakeTimers();
    const client = new MockRedis();
    const getSnap = jest.fn(() => ({ bullPct: 34, bearPct: 15, gauges: { c: 1 } }));
    startSnapshotWriter(client, { coin: 'BTC', getSnapshot: getSnap });

    jest.advanceTimersByTime(3100);
    const first = client.store.get('snap:BTC');
    expect(first).toBeDefined();
    const parsed = JSON.parse(first);
    expect(parsed.bullPct).toBe(34);
    expect(client.ttl.get('snap:BTC')).toBe(5);

    jest.advanceTimersByTime(3000);
    const second = client.store.get('snap:BTC');
    expect(second).toBeDefined();
    expect(client.ttl.get('snap:BTC')).toBe(5);
    jest.useRealTimers();
  });
});
