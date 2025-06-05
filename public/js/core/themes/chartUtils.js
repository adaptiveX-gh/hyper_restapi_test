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
    const updateOpts = { chart:{}, xAxis:[{}], yAxis:[{}], tooltip:{}, legend:{} };
    if (theme.chart?.backgroundColor !== undefined)
      updateOpts.chart.backgroundColor = theme.chart.backgroundColor;
    if (theme.chart?.style) updateOpts.chart.style = theme.chart.style;

    if (theme.xAxis?.gridLineColor !== undefined)
      updateOpts.xAxis[0].gridLineColor = theme.xAxis.gridLineColor;
    if (theme.xAxis?.labels?.style)
      updateOpts.xAxis[0].labels = { style: theme.xAxis.labels.style };

    if (theme.yAxis?.gridLineColor !== undefined)
      updateOpts.yAxis[0].gridLineColor = theme.yAxis.gridLineColor;
    if (theme.yAxis?.labels?.style)
      updateOpts.yAxis[0].labels = { style: theme.yAxis.labels.style };

    if (theme.tooltip?.backgroundColor !== undefined)
      updateOpts.tooltip.backgroundColor = theme.tooltip.backgroundColor;
    if (theme.tooltip?.style) updateOpts.tooltip.style = theme.tooltip.style;

    if (theme.legend?.itemStyle?.color !== undefined)
      updateOpts.legend.itemStyle = { color: theme.legend.itemStyle.color };

    c.update(updateOpts, false, false, false);
    c.redraw(false);
  });
}
