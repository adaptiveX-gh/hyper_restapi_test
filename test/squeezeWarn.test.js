/** @jest-environment jsdom */
import { SignalRadar } from '../public/js/core/signalRadar.js';

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
      redraw: jest.fn()
    }))
  };
}

describe('Micro-Squeeze warning signals', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.Highcharts = makeHighchartsStub();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('uses config properties for up event', () => {
    const radar = new SignalRadar('rad');
    radar.addSqueezeWarnUp({ strength: 0.3, ts: Date.now() });
    const cfg = radar.config.squeeze_warn_up;
    const p = radar.chart.series[1].data[0];
    expect(p.x).toBe(cfg.zone);
    expect(p.color).toBe(cfg.color);
    expect(p.marker.symbol).toBe(cfg.shape);
    expect(p.tag).toBe(cfg.label);
  });

  test('uses config properties for down event', () => {
    const radar = new SignalRadar('rad');
    radar.addSqueezeWarnDown({ strength: 0.3, ts: Date.now() });
    const cfg = radar.config.squeeze_warn_down;
    const p = radar.chart.series[0].data[0];
    expect(p.x).toBe(cfg.zone);
    expect(p.color).toBe(cfg.color);
    expect(p.marker.symbol).toBe(cfg.shape);
    expect(p.tag).toBe(cfg.label);
  });
});
