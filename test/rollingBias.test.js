import { RollingBias } from '../public/js/lib/rollingBias.js';

describe('RollingBias', () => {
  test('handles absorptions and exhaustions with weights', () => {
    const rb = new RollingBias(3);
    rb.push('absorption', 'buy');
    expect(rb.value()).toBeCloseTo(1);
    rb.push('exhaustion', 'sell');
    expect(rb.value()).toBeCloseTo((1 - 0.3) / 2);
    rb.push('absorption', 'sell');
    // window size 3 so all events included
    expect(rb.value()).toBeCloseTo((1 - 0.3 - 1) / 3);
  });

  test('drops old events beyond window', () => {
    const rb = new RollingBias(2);
    rb.push('absorption', 'buy');
    rb.push('exhaustion', 'buy');
    rb.push('absorption', 'sell');
    // first event should be dropped
    const expected = ((0.3) + (-1)) / 2;
    expect(rb.value()).toBeCloseTo(expected);
  });
});
