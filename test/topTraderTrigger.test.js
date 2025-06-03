/** @jest-environment jsdom */
import { onGaugeUpdate, resetTrigger, setWarmupMs } from '../public/js/core/topTraderTrigger.js';
import bus from '../public/js/core/eventBus.js';
import { logMiss } from '../public/js/core/missLogger.js';

jest.mock('../public/js/core/missLogger.js', () => ({
  logMiss: jest.fn(() => Promise.resolve())
}));

describe('topTraderTrigger', () => {
  beforeEach(() => {
    resetTrigger();
    setWarmupMs(0);
    bus.removeAllListeners();
    logMiss.mockClear();
  });

  test('fires LONG when bull crosses above 45', () => {
    const events = [];
    bus.on('trade:fire', e => events.push(e));
    onGaugeUpdate({ bullPct: 44, bearPct: 10, midPrice: 100 });
    onGaugeUpdate({ bullPct: 46, bearPct: 10, midPrice: 100 });
    expect(logMiss).toHaveBeenCalledTimes(1);
    expect(events[0].dir).toBe('LONG');
  });

  test('debounces until gauge drops below threshold', () => {
    const events = [];
    bus.on('trade:fire', e => events.push(e));
    onGaugeUpdate({ bullPct: 46, bearPct: 0 });
    onGaugeUpdate({ bullPct: 50, bearPct: 0 });
    expect(logMiss).toHaveBeenCalledTimes(1);
    onGaugeUpdate({ bullPct: 44, bearPct: 0 });
    onGaugeUpdate({ bullPct: 46, bearPct: 0 });
    expect(logMiss).toHaveBeenCalledTimes(2);
    expect(events.length).toBe(2);
  });

  test('fires SHORT when bear crosses above 45', () => {
    const events = [];
    bus.on('trade:fire', e => events.push(e));
    onGaugeUpdate({ bearPct: 46, bullPct: 10, midPrice: 200 });
    expect(logMiss).toHaveBeenCalledTimes(1);
    expect(events[0].dir).toBe('SHORT');
  });

  test('does not fire during warmup period', () => {
    setWarmupMs(5000);
    resetTrigger();
    const events = [];
    bus.on('trade:fire', e => events.push(e));
    onGaugeUpdate({ bullPct: 50, bearPct: 0 });
    expect(logMiss).not.toHaveBeenCalled();
    expect(events.length).toBe(0);
  });
});
