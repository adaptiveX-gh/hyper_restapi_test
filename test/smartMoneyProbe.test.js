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
      redraw: jest.fn(),
      plotLeft: 0,
      plotTop: 0,
      plotWidth: 200,
      plotHeight: 200,
      renderTo: document.createElement('div')
    }))
  };
}

describe('Smart Money Probe signal', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.Highcharts = makeHighchartsStub();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('updates existing bubble instead of adding new', () => {
    const radar = new SignalRadar('rad');
    const cfg = radar.config.smart_money_probe_up;
    radar.addOrUpdateProbe({ id: 'smart_money_probe_up', strength: 0.5, ts: 0 });
    expect(radar.chart.series[1].data.length).toBe(1);
    const p = radar.chart.series[1].data[0];
    const [min, max] = radar.calcZoneRange(cfg);
    expect(p.x).toBeGreaterThanOrEqual(min);
    expect(p.x).toBeLessThanOrEqual(max);
    expect(p.color).toBe(cfg.color);
    expect(p.marker.symbol).toBe(cfg.shape);
    expect(p.tag).toBe(cfg.label);
    expect(cfg.implementationTip).toBe('OB-CFD \u0394>0 & price \u0394<0 for \u22653 ticks');

    radar.addOrUpdateProbe({ id: 'smart_money_probe_up', strength: 0.8, ts: 1000 });
    expect(radar.chart.series[1].data.length).toBe(1);
    const updated = radar.chart.series[1].data[0];
    const expectedSize = Math.min(Math.abs(0.8) / (cfg.normalize.max ?? 1), 1) * 40;
    expect(updated.z).toBeCloseTo(expectedSize);
    expect(updated.xRaw).toBe(1000);
  });
});
