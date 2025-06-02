export class SignalRadar {
  constructor(containerId) {
    this.points = [];
    this.chart = Highcharts.chart(containerId, {
      chart: { type: 'bubble', height: 250, backgroundColor: 'transparent' },
      title: { text: '<b>Flow-Signal Radar</b>', align: 'center', style:{fontSize:'16px'} },
      colorAxis: {
        min: -1,
        max: 1,
        stops: [
          [0, '#ff4d4d'],
          [0.5, '#f4d142'],
          [1, '#17c964']
        ]
      },
      xAxis: { min: -1.05, max: 1.05, tickInterval: 0.5, gridLineWidth: 1 },
      yAxis: { min: 0, max: 180, reversed: true, gridLineWidth: 1,
        labels: { formatter() { return this.value + ' s'; } } },
      tooltip: {
        useHTML: true,
        pointFormatter() {
          const m = this.meta || {};
          const d = typeof m['\u0394Depth'] === 'number' ?
            `Bids +${m['\u0394Depth'].toFixed(0)}$` : '';
          const p = typeof m.PxTrend === 'number' ?
            ` price ${m.PxTrend.toFixed(2)}%` : '';
          return `<b>${this.tag}</b><br>` +
            Highcharts.dateFormat('%H:%M:%S', this.xRaw) + '<br>' +
            `Strength ${Highcharts.numberFormat(this.strength,2)}<br>` + d + p;
        }
      },
      series: [{ name: 'Signals', colorKey: 'colorValue', data: [] }],
      plotOptions: { bubble: { minSize: 12, maxSize: 40, opacity: 0.85 } },
      credits: { enabled: false },
      exporting: { enabled: false }
    });
    this.timer = setInterval(()=>this.tick(), 1000);
  }

  addProbe({ stateScore=0, strength=0.3, ts=Date.now(), meta={} }) {
    const point = {
      x: stateScore,
      y: 0,
      z: Math.sqrt(strength) * 35,
      colorValue: stateScore,
      marker: { symbol: 'triangle' },
      tag: 'Probe',
      xRaw: ts,
      strength,
      meta
    };
    this.chart.series[0].addPoint(point, true, false, { duration: 300 });
    this.points.push({ born: ts, strength, point });
    if (this.points.length > 400) {
      this.points.sort((a,b)=>a.strength-b.strength);
      const excess = this.points.splice(0, this.points.length-400);
      excess.forEach(p=>{
        const idx = this.chart.series[0].data.indexOf(p.point);
        if (idx>-1) this.chart.series[0].data[idx].remove(false);
      });
      this.chart.redraw(false);
    }
  }

  addEarlyWarn({
    stateScore = 0,
    strength = 0.1,
    ts = Date.now(),
    side = 'ask',
    meta = {}
  }) {
    const bullish = side === 'ask';
    const point = {
      x: stateScore,
      y: 0,
      z: Math.sqrt(Math.abs(strength)) * 120,
      colorValue: stateScore,
      marker: { symbol: bullish ? 'triangle' : 'triangle-down' },
      tag: bullish ? 'Ask exhaustion' : 'Bid exhaustion',
      xRaw: ts,
      strength: Math.abs(strength),
      meta: { value: strength, ...meta }
    };
    if (point.strength < 0.05) return;
    this.chart.series[0].addPoint(point, true, false, { duration: 300 });
    this.points.push({ born: ts, strength: point.strength, point });
    if (this.points.length > 400) {
      this.points.sort((a, b) => a.strength - b.strength);
      const excess = this.points.splice(0, this.points.length - 400);
      excess.forEach(p => {
        const idx = this.chart.series[0].data.indexOf(p.point);
        if (idx > -1) this.chart.series[0].data[idx].remove(false);
      });
      this.chart.redraw(false);
    }
  }

  tick() {
    const now = Date.now();
    const series = this.chart.series[0];
    let dirty = false;
    for (let i = this.points.length-1; i >= 0; i--) {
      const p = this.points[i];
      const age = (now - p.born)/1000;
      if (age > 180) {
        const idx = series.data.indexOf(p.point);
        if (idx>-1) series.data[idx].remove(false);
        this.points.splice(i,1);
        dirty = true;
      } else {
        const idx = series.data.indexOf(p.point);
        if (idx>-1) series.data[idx].update({ y: age }, false);
        dirty = true;
      }
    }
    if (dirty) this.chart.redraw(false);
  }

  destroy() { clearInterval(this.timer); }
}
