/** @jest-environment jsdom */
import { PongGame, vFromSigma, chase } from '../public/js/core/pong.js';

describe('Pong helpers', () => {
  test('vFromSigma maps volatility to speed', () => {
    expect(vFromSigma(0)).toBeCloseTo(0.6, 2);
    expect(vFromSigma(3)).toBeCloseTo(2.5, 1);
  });

  test('chase moves paddle toward ball', () => {
    const p = { y: 10 };
    chase(p, 20, 1.3); // base0.6 + factor3*(0.3)=1.5
    expect(p.y).toBeCloseTo(11.5, 2);
  });

  test('chase has baseline speed at OBI neutral', () => {
    const p = { y: 5 };
    chase(p, 8, 1.0);
    expect(p.y).toBeCloseTo(5.6, 2); // base speed 0.6
  });
});

describe('PongGame update', () => {
  beforeEach(() => {
    global.requestAnimationFrame = fn => 1;
  });

  test('updatePong survives missing obi', () => {
    const chart = { plotLeft:0, plotTop:0, plotWidth:200, plotHeight:200, renderTo: document.createElement('div') };
    const game = new PongGame(chart, true);
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
    const game = new PongGame(chart, true);
    game.update({ bullPct:60, bearPct:10, midPrice:100 });
    game.registerMiss('left');
    const log = JSON.parse(localStorage.getItem('tradeLog') || '[]');
    expect(log.length).toBe(1);
    expect(log[0].dir).toBe('LONG');
  });

  test('registerMiss force logs trade below composite threshold', () => {
    const chart = { plotLeft:0, plotTop:0, plotWidth:200, plotHeight:200, renderTo: document.createElement('div') };
    const game = new PongGame(chart, true);
    game.update({ bullPct:20, bearPct:80, midPrice:50 });
    window.contextMetrics = {
      confirm: 0.2,
      earlyWarn: 0,
      resilience: 0,
      LaR: 0.5,
      shock: 0,
      biasSlope15m: 0
    };
    game.registerMiss('left', { force: true });
    const log = JSON.parse(localStorage.getItem('tradeLog') || '[]');
    expect(log.length).toBe(1);
    expect(log[0].dir).toBe('LONG');
    window.contextMetrics = undefined;
  });
});

describe('PongGame collision detection', () => {
  beforeEach(() => {
    global.requestAnimationFrame = () => {};
  });

  test('ball crossing paddle outside range triggers miss', () => {
    const chart = { plotLeft:0, plotTop:0, plotWidth:200, plotHeight:200, renderTo: document.createElement('div') };
    const game = new PongGame(chart, true);
    const leftX = game.leftBoundary();
    const paddleW = game.paddleWidth;
    game.leftY = chart.plotHeight * 0.1;
    game.ballX = leftX + paddleW + game.ballRadius + 1;
    game.ballY = chart.plotHeight - 10;
    game.vx = -30;
    game.vy = 0;
    game.registerMiss = jest.fn();
    game.loop();
    expect(game.registerMiss).toHaveBeenCalledWith('left');
  });

  test('ball crossing paddle within range bounces', () => {
    const chart = { plotLeft:0, plotTop:0, plotWidth:200, plotHeight:200, renderTo: document.createElement('div') };
    const game = new PongGame(chart, true);
    const leftX = game.leftBoundary();
    const paddleW = game.paddleWidth;
    game.leftY = chart.plotHeight / 2;
    game.ballX = leftX + paddleW + game.ballRadius + 1;
    game.ballY = game.leftY;
    game.vx = -30;
    game.vy = 0;
    game.loop();
    expect(game.vx).toBeGreaterThan(0);
  });
});

describe('PongGame resetScores', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('scores and timer reset to zero', () => {
    const chart = { plotLeft:0, plotTop:0, plotWidth:200, plotHeight:200, renderTo: document.createElement('div') };
    const game = new PongGame(chart, true);
    game.bullScore = 3;
    game.bearScore = 2;
    game.timerStart = 1000;
    jest.setSystemTime(5000);
    game.resetScores();
    expect(game.bullScore).toBe(0);
    expect(game.bearScore).toBe(0);
    expect(game.timerStart).toBe(5000);
  });
});
