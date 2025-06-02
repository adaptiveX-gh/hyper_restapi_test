export class SignalRadar {
  constructor(containerId) {
    this.points = [];
    this.selectedSign = null;
    const bands = [
      { from: -1.05, to: -0.6,  label:{ text:'Compression'          , style:{color:'#345'} } },
      { from: -0.6, to: -0.2,  label:{ text:'Range / Chop'          , style:{color:'#345'} } },
      { from: -0.2, to:  0.2,  label:{ text:'Neutral'               , style:{color:'#345'} } },
      { from:  0.2, to:  0.6,  label:{ text:'Break-out / Pull-back', style:{color:'#345'} } },
      { from:  0.6, to:  1.05, label:{ text:'Exhaust / Reversal'   , style:{color:'#345'} } }
    ];

    this.chart = Highcharts.chart(containerId, {
      chart: {
        type: 'bubble',
        height: 420,
        backgroundColor: 'transparent',
        events: {
          click: () => this.highlight(null)
        }
      },
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
      xAxis: {
        min: -1.05,
        max: 1.05,
        tickInterval: 0.5,
        gridLineWidth: 1,
        plotBands: bands
      },
      yAxis: {
        min: 0,
        max: 180,
        reversed: true,
        gridLineWidth: 1,
        labels: { formatter() { return this.value + ' s'; } }
      },
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
      series: [{
        name: 'Signals',
        colorKey: 'colorValue',
        data: [],
        point: {
          events: {
            click: function(){
              this.series.chart.options.custom.radar.highlight(this);
            }
          }
        }
      }],
      plotOptions: { bubble: { minSize: 12, maxSize: 40, opacity: 0.85 } },
      credits: { enabled: false },
      exporting: { enabled: false },
      custom: { radar: this }
    });
    this.timer = setInterval(() => this.tick(), 1000);
  }

  addProbe({ stateScore=0, strength=0.3, ts=Date.now(), meta={}, startY=0, colorValue=null }) {
    const val = colorValue ?? stateScore;
    const sign = Math.sign(val);
    const point = {
      x: stateScore,
      y: startY,
      z: Math.sqrt(Math.abs(strength)) * 35,
      colorValue: val,
      color: sign >= 0 ? '#17c964' : '#ff4d4d',
      marker: { symbol: 'circle' },
      tag: 'Probe',
      xRaw: ts,
      strength,
      meta
    };
    this.chart.series[0].addPoint(point, true, false, { duration: 300 });
    this.points.push({ born: ts, startY, strength, point });
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
    meta = {},
    startY = 0
  }) {
    const bullish = side === 'ask';
    const val = bullish ? 1 : -1;
    const sign = val;
    const point = {
      x: stateScore,
      y: startY,
      z: Math.sqrt(Math.abs(strength)) * 120,
      colorValue: val,
      color: sign >= 0 ? '#17c964' : '#ff4d4d',
      marker: { symbol: 'circle' },
      tag: bullish ? 'Ask exhaustion' : 'Bid exhaustion',
      xRaw: ts,
      strength: Math.abs(strength),
      meta: { value: strength, ...meta }
    };
    if (point.strength < 0.05) return;
    this.chart.series[0].addPoint(point, true, false, { duration: 300 });
    this.points.push({ born: ts, startY, strength: point.strength, point });
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
    for (let i = this.points.length - 1; i >= 0; i--) {
      const p = this.points[i];
      const age = (now - p.born) / 1000 + (p.startY || 0);
      if (age > 180) {
        const idx = series.data.indexOf(p.point);
        if (idx > -1) series.data[idx].remove(false);
        this.points.splice(i, 1);
        dirty = true;
      } else {
        const idx = series.data.indexOf(p.point);
        if (idx > -1) series.data[idx].update({ y: age }, false);
        dirty = true;
      }
    }
    if (dirty) this.chart.redraw(false);
  }

  highlight(point) {
    this.selectedSign = point ? Math.sign(point.colorValue || 0) : null;
    const series = this.chart.series[0];
    series.data.forEach(p => {
      const same = this.selectedSign == null || Math.sign(p.colorValue || 0) === this.selectedSign;
      p.update({ marker: { fillOpacity: same ? 0.85 : 0.2, lineWidth: same && this.selectedSign != null ? 2 : 0 } }, false);
    });
    this.chart.redraw(false);
  }

  destroy() { clearInterval(this.timer); }
}
