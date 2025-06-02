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

describe('SignalRadar', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    global.Highcharts = makeHighchartsStub();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('bubble drifts down with time', () => {
    const radar = new SignalRadar('rad');
    radar.addProbe({ stateScore: 0, strength: 0.5, ts: Date.now() });
    const point = radar.chart.series[0].data[0];
    expect(point.y).toBe(0);

    jest.advanceTimersByTime(10000);
    jest.setSystemTime(10000);

    expect(point.y).toBeCloseTo(10, 0);
  });

  test('bubble removed after 180s', () => {
    const radar = new SignalRadar('rad');
    radar.addProbe({ stateScore: 0, strength: 0.5, ts: Date.now() });
    const point = radar.chart.series[0].data[0];

    jest.advanceTimersByTime(181000);
    jest.setSystemTime(181000);

    expect(point.removed).toBe(true);
    expect(radar.chart.series[0].data).not.toContain(point);
  });

  test('bubble can start at custom recency', () => {
    const radar = new SignalRadar('rad');
    radar.addProbe({ stateScore: 0, strength: 0.4, ts: Date.now(), startY: 10 });
    const point = radar.chart.series[0].data[0];
    expect(point.y).toBe(10);

    jest.advanceTimersByTime(5000);
    jest.setSystemTime(5000);

    expect(point.y).toBeCloseTo(15, 0);
  });
});
