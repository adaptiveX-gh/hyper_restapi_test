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
      redraw: jest.fn()
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
    expect(p.x).toBe(cfg.zone);
    expect(p.color).toBe(cfg.color);
    expect(p.marker.symbol).toBe(cfg.shape);
    expect(p.tag).toBe(cfg.label);
  });
});
