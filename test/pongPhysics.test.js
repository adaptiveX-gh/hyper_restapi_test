/** @jest-environment jsdom */
import { PongGame, vFromSigma, chase } from '../public/js/core/pong.js';

describe('Pong helpers', () => {
  test('vFromSigma maps volatility to speed', () => {
    expect(vFromSigma(0)).toBeCloseTo(0.3, 2);
    expect(vFromSigma(3)).toBeCloseTo(1.2, 1);
  });

  test('chase moves paddle toward ball', () => {
    const p = { y: 10 };
    chase(p, 20, 1.3); // (1.3-1)*1.5 = 0.45
    expect(p.y).toBeCloseTo(10 + 0.45, 2);
  });
});

describe('PongGame update', () => {
  beforeEach(() => {
    global.requestAnimationFrame = fn => 1;
  });

  test('updatePong survives missing obi', () => {
    const chart = { plotLeft:0, plotTop:0, plotWidth:200, plotHeight:200, renderTo: document.createElement('div') };
    const game = new PongGame(chart);
    expect(() => game.update({ bearPct:10, bullPct:20 })).not.toThrow();
  });
});

describe('PongGame miss logging', () => {
  beforeEach(() => {
    global.requestAnimationFrame = fn => 1; // stub
    localStorage.clear();
  });

  test('registerMiss stores trade when conditions met', () => {
    const chart = { plotLeft:0, plotTop:0, plotWidth:200, plotHeight:200, renderTo: document.createElement('div') };
    const game = new PongGame(chart);
    game.update({ bullPct:60, bearPct:10, midPrice:100 });
    game.registerMiss('left');
    const log = JSON.parse(localStorage.getItem('tradeLog') || '[]');
    expect(log.length).toBe(1);
    expect(log[0].dir).toBe('LONG');
  });
});
