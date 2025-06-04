/** @jest-environment jsdom */
import { SignalRadar } from '../public/js/core/signalRadar.js';
import { handleWhaleAnomaly } from '../public/js/core/whaleHandler.js';

function makeHighchartsStub() {
  const makeSeries = () => ({
    data: [],
    addPoint(point) {
      this.data.push(Object.assign(point, {
        update(changes) { Object.assign(this, changes); },
        remove() { this.removed = true; }
      }));
    }
  });
  return {
    chart: jest.fn(() => ({
      series: [makeSeries(), makeSeries()],
      redraw: jest.fn(),
      plotLeft: 0,
      plotTop: 0,
      plotWidth: 200,
      plotHeight: 200,
      renderTo: document.createElement('div')
    }))
  };
}

describe('Mega whale bubble', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.Highcharts = makeHighchartsStub();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('uses config properties', () => {
    const radar = new SignalRadar('rad');
    radar.addBubble('mega_whale_up', { strength: 2, ts: Date.now() });
    const cfg = radar.config.mega_whale_up;
    const p = radar.chart.series[1].data[0];
    const [minUp, maxUp] = radar.calcZoneRange(cfg);
    expect(p.x).toBeGreaterThanOrEqual(minUp);
    expect(p.x).toBeLessThanOrEqual(maxUp);
    expect(p.color).toBe(cfg.color);
    expect(p.marker.symbol).toBe(cfg.shape);
    expect(p.tag).toBe(cfg.label);
  });

  test('handler routes worker event', () => {
    const radar = { addBubble: jest.fn() };
    const msg = { type: 'anomaly', payload: { ts: 123, strength: 1, kind: 'mega_whale_up' } };
    handleWhaleAnomaly(radar, msg);
    expect(radar.addBubble).toHaveBeenCalledWith('mega_whale_up', { ts: 123, strength: 1 });
  });
});

describe('Baby whale bubble', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.Highcharts = makeHighchartsStub();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('uses config properties', () => {
    const radar = new SignalRadar('rad');
    radar.addBubble('baby_whale_up', { strength: 0.7, ts: Date.now() });
    const cfg = radar.config.baby_whale_up;
    const p = radar.chart.series[1].data[0];
    const [minUp, maxUp] = radar.calcZoneRange(cfg);
    expect(p.x).toBeGreaterThanOrEqual(minUp);
    expect(p.x).toBeLessThanOrEqual(maxUp);
    expect(p.color).toBe('#3399ff');
    expect(p.marker.symbol).toBe(cfg.shape);
    expect(p.tag).toBe(cfg.label);
  });

  test('handler routes worker event', () => {
    const radar = { addBubble: jest.fn() };
    const msg = {
      type: 'anomaly',
      payload: { ts: 456, strength: 0.66, kind: 'baby_whale_up' }
    };
    handleWhaleAnomaly(radar, msg);
    expect(radar.addBubble).toHaveBeenCalledWith('baby_whale_up', { ts: 456, strength: 0.66 });
  });
});
