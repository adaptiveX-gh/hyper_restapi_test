import { classifyObi } from '../public/js/core/utils.js';

describe('classifyObi', () => {
  test('returns bull above neutral', () => {
    expect(classifyObi(1.2, 0.07)).toBe('bull');
  });

  test('returns bear below neutral', () => {
    expect(classifyObi(0.8, 0.07)).toBe('bear');
  });

  test('returns flat inside band', () => {
    expect(classifyObi(1.03, 0.07)).toBe('flat');
  });
});
