/** @jest-environment jsdom */
import { logMiss } from '../public/js/core/missLogger.js';

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
});
