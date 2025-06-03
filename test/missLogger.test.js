/** @jest-environment jsdom */
import { logMiss } from '../public/js/core/missLogger.js';

describe('missLogger', () => {
  beforeEach(() => {
    localStorage.clear();
    window.GS_LOG_URL = '';
  });

  test('logMiss stores entry when no URL', () => {
    logMiss({ side:'bull', dir:'LONG' });
    const q = JSON.parse(localStorage.getItem('missLogQueue') || '[]');
    expect(q.length).toBe(1);
    expect(q[0].side).toBe('bull');
  });
});
