/** @jest-environment jsdom */
import { SignalRadar } from '../public/js/core/signalRadar.js';

function makeHighchartsStub() {
  return {
    chart: jest.fn(() => ({
      series: [{
        data: [],
        addPoint(point) {
          this.data.push(Object.assign(point, {
            update(changes) { Object.assign(this, changes); },
            remove() { this.removed = true; }
          }));
        }
      }],
      redraw: jest.fn(),
      plotLeft: 0,
      plotTop: 0,
      plotWidth: 200,
      plotHeight: 200,
      renderTo: document.createElement('div')
    }))
  };
}

describe('Flow Flip Squeeze signal', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.Highcharts = makeHighchartsStub();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('uses config properties for bearish squeeze', () => {
    const radar = new SignalRadar('rad');
    radar.addFlowFlipSqueezeDown({ strength: 0.6, ts: Date.now() });
    const cfg = radar.config.flow_flip_squeeze_down;
    const p = radar.chart.series[0].data[0];
    const [min, max] = radar.calcZoneRange(cfg);
    expect(p.x).toBeGreaterThanOrEqual(min);
    expect(p.x).toBeLessThanOrEqual(max);
    expect(p.color).toBe(cfg.color);
    expect(p.marker.symbol).toBe(cfg.shape);
    expect(p.tag).toBe(cfg.label);
  });
});
