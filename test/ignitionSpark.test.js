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

describe('Ignition Spark signal', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.Highcharts = makeHighchartsStub();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('uses config properties', () => {
    const radar = new SignalRadar('rad');
    radar.addIgnitionSpark({ side: 'up', strength: 0.8, ts: Date.now() });
    const cfg = radar.config.ignition_spark_up;
    const p = radar.chart.series[1].data[0];
    expect(p.x).toBe(cfg.zone);
    expect(p.color).toBe(cfg.color);
    expect(p.marker.symbol).toBe(cfg.shape);
    expect(p.tag).toBe(cfg.label);
  });
});
