/** @jest-environment jsdom */
import { logMiss, flushQueue } from '../public/js/core/missLogger.js';

describe('missLogger', () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('ok') })
    );
  });

  test('logMiss stores entry when no URL', () => {
    logMiss({ side:'bull', dir:'LONG' });
    const q = JSON.parse(localStorage.getItem('missLogQueue') || '[]');
    expect(q.length).toBe(1);
    expect(q[0].side).toBe('bull');
  });

  test('flushQueue avoids duplicate sends', async () => {
    localStorage.setItem('missLogQueue', JSON.stringify([{ foo: 'bar' }]));
    const p1 = flushQueue();
    const p2 = flushQueue();
    await Promise.all([p1, p2]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const q = JSON.parse(localStorage.getItem('missLogQueue') || '[]');
    expect(q.length).toBe(0);
  });
});
