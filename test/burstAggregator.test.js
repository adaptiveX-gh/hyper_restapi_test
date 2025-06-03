import { handleFill, flushAll, resetAggregator, setEmitHandler, BUCKET_MS, getHiddenCount } from '../src/burstAggregator.js';

describe('burstAggregator', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetAggregator();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('hides rows below threshold', () => {
    const emitted = jest.fn();
    setEmitHandler(emitted);
    for (let i = 0; i < 10; i++) {
      handleFill({ trader: '0xabc', side: 'LONG', notional:2000, price:1, weight:0.5, bias:1 });
    }
    jest.advanceTimersByTime(BUCKET_MS);
    flushAll();
    expect(emitted).not.toHaveBeenCalled();
    expect(getHiddenCount()).toBe(1);
  });

  test('aggregates burst into one row', () => {
    const emitted = jest.fn();
    setEmitHandler(emitted);
    for (let i = 0; i < 5; i++) {
      handleFill({ trader: '0xdef', side: 'LONG', notional:60000, price: i + 1, weight:0.7, bias:1 });
    }
    jest.advanceTimersByTime(BUCKET_MS);
    flushAll();
    expect(emitted).toHaveBeenCalledTimes(1);
    const row = emitted.mock.calls[0][0];
    expect(row.notional).toBeCloseTo(300000);
    const expectedPrice = (60000*1 + 60000*2 + 60000*3 + 60000*4 + 60000*5) / 300000;
    expect(row.price).toBeCloseTo(+expectedPrice.toFixed(2));
  });
});
