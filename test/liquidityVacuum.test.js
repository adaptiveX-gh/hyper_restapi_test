/** @jest-environment jsdom */
import { handleLiquidityVacuum, resetLiquidityVacuum } from '../public/js/core/minorityTicker.js';

describe('Liquidity Vacuum ticker', () => {
  beforeEach(() => {
    resetLiquidityVacuum();
    document.body.innerHTML = '<div id="ticker-box"><span id="ticker-inner"></span></div>';
  });

  test('fires ticker and bubble once', () => {
    const radar = { addBubble: jest.fn() };
    const ctx = { LaR: 0.2, resilience: -0.1, confirm: -0.25, momentum: -0.11 };
    handleLiquidityVacuum(radar, ctx, 1000);
    expect(document.getElementById('ticker-inner').textContent)
      .toBe('🩸 Liquidity Vacuum — Expect Flush');
    expect(radar.addBubble).toHaveBeenCalledWith('liquidity_vacuum_flush', { ts: 1000, strength: 1 });
    handleLiquidityVacuum(radar, ctx, 2000);
    expect(radar.addBubble).toHaveBeenCalledTimes(1);
  });
});
