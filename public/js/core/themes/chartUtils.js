/**
 * Apply a Highcharts theme to all existing charts.
 *
 * Updates the following chart properties:
 *  - chart.backgroundColor
 *  - chart.style.color
 *  - xAxis[0].gridLineColor
 *  - xAxis[0].labels.style.color
 *  - yAxis[0].gridLineColor
 *  - yAxis[0].labels.style.color
 *  - tooltip.backgroundColor & tooltip.style.color
 *  - legend.itemStyle.color
 *
 * @param {object} theme Highcharts theme object
 */
export function applyThemeToCharts(theme) {
  if (!window.Highcharts || !Array.isArray(window.Highcharts.charts)) return;

  window.Highcharts.charts.forEach(c => {
    if (!c) return;
    c.update({
      chart: {
        backgroundColor: theme.chart?.backgroundColor,
        style: theme.chart?.style
      },
      xAxis: [{
        gridLineColor: theme.xAxis?.gridLineColor,
        labels: { style: theme.xAxis?.labels?.style }
      }],
      yAxis: [{
        gridLineColor: theme.yAxis?.gridLineColor,
        labels: { style: theme.yAxis?.labels?.style }
      }],
      tooltip: {
        backgroundColor: theme.tooltip?.backgroundColor,
        style: theme.tooltip?.style
      },
      legend: {
        itemStyle: { color: theme.legend?.itemStyle?.color }
      }
    }, false, false, false);
    c.redraw(false);
  });
}
