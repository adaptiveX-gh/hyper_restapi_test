import { computeOverExt } from '../public/js/core/utils.js';

describe('computeOverExt', () => {
  test('returns high value for strong over-extension', () => {
    const val = computeOverExt({ zPrice: 3, biasSlope15m: 0.9, rsi15m: 80 });
    expect(val).toBeGreaterThanOrEqual(0.85);
  });
});
