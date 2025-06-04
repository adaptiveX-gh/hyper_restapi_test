import { computeTrap } from '../public/js/core/utils.js';

describe('computeTrap', () => {
  test('returns positive for bull trap conditions', () => {
    const val = computeTrap({ confirm: 0.3, LaR: 0.2, earlyWarn: -0.1, resilience: -0.2 });
    expect(val).toBeGreaterThanOrEqual(0.75);
  });

  test('returns negative for bear trap conditions', () => {
    const val = computeTrap({ confirm: -0.4, LaR: 0.25, earlyWarn: 0.2, resilience: 0.3 });
    expect(val).toBeLessThanOrEqual(-0.75);
  });

  test('returns near zero when conditions not met', () => {
    const val = computeTrap({ confirm: 0, LaR: 0.5, earlyWarn: 0, resilience: 0 });
    expect(Math.abs(val)).toBeLessThan(0.3);
  });
});
