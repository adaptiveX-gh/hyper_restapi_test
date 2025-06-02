import { detectControlledPullback } from '../public/js/lib/detectControlledPullback.js';

describe('detectControlledPullback', () => {
  test('returns signal when conditions met', () => {
    const now = Date.now();
    const imb = [
      { value: -0.5, ts: now - 3000 },
      { value: -0.3, ts: now - 2000 },
      { value: -0.2, ts: now - 1000 },
      { value: -0.4, ts: now }
    ];
    const conf = [
      { value: 0.1, ts: now - 3000 },
      { value: 0.2, ts: now - 2000 },
      { value: 0.05, ts: now - 1000 },
      { value: 0.0, ts: now }
    ];
    const res = detectControlledPullback(imb, conf, 1, 4);
    expect(res).not.toBeNull();
    expect(res.id).toBe('controlled_pullback');
    expect(res.strength).toBeGreaterThan(0);
  });

  test('returns null when confirmation negative', () => {
    const now = Date.now();
    const imb = [
      { value: -0.2, ts: now - 2000 },
      { value: -0.3, ts: now - 1000 },
      { value: -0.4, ts: now }
    ];
    const conf = [
      { value: 0.1, ts: now - 2000 },
      { value: -0.1, ts: now - 1000 },
      { value: 0.2, ts: now }
    ];
    const res = detectControlledPullback(imb, conf, 1, 3);
    expect(res).toBeNull();
  });
});
