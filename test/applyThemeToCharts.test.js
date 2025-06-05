/** @jest-environment jsdom */
import { applyThemeToCharts } from '../public/js/core/themes/chartUtils.js';

const theme = {
  chart: { backgroundColor: 'bg', style: { color: 't' } },
  xAxis: { gridLineColor: 'xg', labels: { style: { color: 'xc' } } },
  yAxis: { gridLineColor: 'yg', labels: { style: { color: 'yc' } } },
  tooltip: { backgroundColor: 'tb', style: { color: 'tc' } },
  legend: { itemStyle: { color: 'lc' } }
};

describe('applyThemeToCharts', () => {
  test('updates all live charts', () => {
    const a = { update: jest.fn(), redraw: jest.fn() };
    const b = { update: jest.fn(), redraw: jest.fn() };
    window.Highcharts = { charts: [a, undefined, b] };

    applyThemeToCharts(theme);

    const expected = {
      chart: { backgroundColor: 'bg', style: { color: 't' } },
      xAxis: [{ gridLineColor: 'xg', labels: { style: { color: 'xc' } } }],
      yAxis: [{ gridLineColor: 'yg', labels: { style: { color: 'yc' } } }],
      tooltip: { backgroundColor: 'tb', style: { color: 'tc' } },
      legend: { itemStyle: { color: 'lc' } }
    };

    expect(a.update).toHaveBeenCalledWith(expected, false, false, false);
    expect(b.update).toHaveBeenCalledWith(expected, false, false, false);
    expect(a.redraw).toHaveBeenCalledWith(false);
    expect(b.redraw).toHaveBeenCalledWith(false);
  });
});
