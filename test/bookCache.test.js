/** @jest-environment jsdom */
import { getBook, abortBookFetch } from '../public/js/core/bookCache.js';

describe('bookCache', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    abortBookFetch();
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ bids: [[1,1]], asks: [[1,1]] })
    }));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('returns same Promise for concurrent calls', () => {
    const p1 = getBook('BTC', 25);
    const p2 = getBook('BTC', 25);
    expect(p1).toBe(p2);
  });

  test('returns null during cooldown', async () => {
    const p1 = getBook('BTC', 25);
    await p1;
    jest.advanceTimersByTime(300);
    const p2 = getBook('BTC', 25);
    expect(p2).toBeNull();
  });
});
