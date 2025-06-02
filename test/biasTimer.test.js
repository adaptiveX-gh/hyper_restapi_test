/** @jest-environment jsdom */
import { BiasTimer } from '../public/js/lib/biasTimer.js';

describe('BiasTimer', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.useFakeTimers();
  });

  test('resumes from saved start time', () => {
    localStorage.setItem('biasTimer', JSON.stringify({ sign: 1, start: 5000 }));
    document.body.innerHTML = '<span id="timer"></span>';
    jest.setSystemTime(8000);
    const timer = new BiasTimer('timer');
    timer.start();
    expect(document.getElementById('timer').textContent).toBe('00:03');
    jest.advanceTimersByTime(2000);
    expect(document.getElementById('timer').textContent).toBe('00:05');
  });

  test('resets when sign changes', () => {
    localStorage.setItem('biasTimer', JSON.stringify({ sign: 1, start: 5000 }));
    document.body.innerHTML = '<span id="timer"></span>';
    jest.setSystemTime(10000);
    const timer = new BiasTimer('timer');
    timer.start();
    expect(timer.elapsedSeconds()).toBe(5);
    timer.update(-0.5);
    expect(timer.elapsedSeconds()).toBe(0);
    jest.advanceTimersByTime(1000);
    expect(document.getElementById('timer').textContent).toBe('00:01');
  });
});
