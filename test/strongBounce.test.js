/** @jest-environment jsdom */
import { handleStrongBounce, resetStrongBounce } from '../public/js/core/minorityTicker.js';

describe('Strong Bounce ticker', () => {
  beforeEach(() => {
    resetStrongBounce();
    document.body.innerHTML = '<div id="ticker-box"><span id="ticker-inner"></span></div>';
  });

  test('fires ticker and bubble once', () => {
    const radar = { addBubble: jest.fn() };
    const ctx = { earlyWarn: 0.06, confirm: 0.3, LaR: 0.35, momentum: 0.11 };
    handleStrongBounce(radar, ctx, 1000);
    expect(document.getElementById('ticker-inner').textContent)
      .toBe('⚡ Strong Bounce Incoming');
    expect(radar.addBubble).toHaveBeenCalledWith('strong_bounce_incoming', { ts: 1000, strength: 1 });
    handleStrongBounce(radar, ctx, 2000);
    expect(radar.addBubble).toHaveBeenCalledTimes(1);
  });
});
