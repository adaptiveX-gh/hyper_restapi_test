/** @jest-environment jsdom */
import { handleLiquidityVacuum, resetLiquidityVacuum, computeFlush } from '../public/js/core/minorityTicker.js';
import bus from '../public/js/core/eventBus.js';
import '../public/js/core/bubbleStream.js';

describe('Liquidity Vacuum ticker', () => {
  beforeEach(() => {
    resetLiquidityVacuum();
    bus.removeAllListeners();
    document.body.innerHTML = '<div id="ticker-box"><span id="ticker-inner"></span></div>';
  });

  test('fires ticker and bubble once', () => {
    const radar = { addBubble: jest.fn() };
    global.window.radar = radar;
    const ctx = { LaR: 0.2, resilience: -0.1, confirm: -0.25, momentum: -0.11, MPD: -0.6 };
    handleLiquidityVacuum(radar, ctx, 1000);
    expect(document.getElementById('ticker-inner').textContent)
      .toBe('🩸 Liquidity Vacuum — Expect Flush');
    expect(radar.addBubble).toHaveBeenCalledWith('liquidity_vacuum_flush', { ts: 1000, strength: 1 });
    handleLiquidityVacuum(radar, ctx, 2000);
    expect(radar.addBubble).toHaveBeenCalledTimes(1);
  });

  test('computeFlush allows sweep override', () => {
    const ctx = {
      LaR: 0.2,
      resilience: -0.1,
      confirm: -0.25,
      momentum: -0.11,
      MPD: -0.3,
      sweepHit: true
    };
    expect(computeFlush(ctx)).toBe(true);
  });
});
