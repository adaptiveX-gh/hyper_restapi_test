import config from './signalConfig.js';

export class SignalRadar {
  constructor(containerId, cfg = config) {
    this.points = [];
    this.selectedSign = null;
    this.config = cfg;
    const regimes = [
      { from: -1.05, to: -0.6,  label:'\u2193 Exhaust / Reversal',   side:'bear',   color:'rgba(255,0,0,0.08)' },
      { from: -0.6,  to: -0.2,  label:'Break-out / Pull-back',      side:'bear',   color:'rgba(255,0,0,0.04)' },
      { from: -0.2,  to:  0.2,  label:'Neutral',                    side:'neutral',color:'rgba(128,128,128,0.06)' },
      { from:  0.2,  to:  0.6,  label:'Break-out / Pull-back',      side:'bull',   color:'rgba(0,255,0,0.04)' },
      { from:  0.6,  to:  1.05, label:'\u2191 Exhaust / Reversal',   side:'bull',   color:'rgba(0,255,0,0.08)' }
    ];
    const bands = regimes.map(r => ({
      from: r.from,
      to: r.to,
      color: r.color,
      label: { text: r.label, style:{ color:'#345' } }
    }));
    this.regimes = regimes;

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
          const r = this.series.chart.options.custom.radar.regimes.find(
            b => this.x >= b.from && this.x <= b.to
          );
          const zone = r ? `${r.label} ` +
            (r.side === 'bear' ? '(bear zone)' : r.side === 'bull' ? '(bull zone)' : '(neutral)')
            : '';
          return `<b>${this.tag}</b><br>` +
            Highcharts.dateFormat('%H:%M:%S', this.xRaw) + '<br>' +
            zone + '<br>' +
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
      custom: { radar: this, regimes }
    });
    this.timer = setInterval(() => this.tick(), 1000);
  }

  addProbe({ stateScore=0, strength=0.3, ts=Date.now(), meta={}, startY=0, colorValue=null }) {
    const cfg  = this.config.probe || {};
    const val  = colorValue ?? stateScore;
    const sign = Math.sign(val);
    const colour = sign >= 0
      ? (cfg.color?.bull || '#17c964')
      : (cfg.color?.bear || '#ff4d4d');
    const scale = cfg.normalization?.scale ?? 35;
    const point = {
      x: stateScore,
      y: startY,
      z: Math.sqrt(Math.abs(strength)) * scale,
      colorValue: val,
      color: colour,
      marker: { symbol: cfg.shape || 'circle' },
      tag: cfg.label || 'Probe',
      xRaw: ts,
      strength,
      meta
    };
    this.chart.series[0].addPoint(point, true, false, { duration: 300 });
    const hcPoint = this.chart.series[0].data[this.chart.series[0].data.length - 1];
    this.points.push({ born: ts, startY, strength, point: hcPoint });
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
    const cfg = bullish ? this.config.askExhaustion : this.config.bidExhaustion || {};
    const val = bullish ? 1 : -1;
    const colour = cfg.color || (bullish ? '#17c964' : '#ff4d4d');
    const scale = cfg.normalization?.scale ?? 120;
    const point = {
      x: stateScore,
      y: startY,
      z: Math.sqrt(Math.abs(strength)) * scale,
      colorValue: val,
      color: colour,
      marker: { symbol: cfg.shape || 'circle' },
      tag: cfg.label || (bullish ? 'Ask exhaustion' : 'Bid exhaustion'),
      xRaw: ts,
      strength: Math.abs(strength),
      meta: { value: strength, ...meta }
    };
    if (point.strength < 0.05) return;
    this.chart.series[0].addPoint(point, true, false, { duration: 300 });
    const hcPoint = this.chart.series[0].data[this.chart.series[0].data.length - 1];
    this.points.push({ born: ts, startY, strength: point.strength, point: hcPoint });
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

  addIgnitionSpark({
    stateScore = 0,
    strength = 0.1,
    ts = Date.now(),
    side = 'up',
    meta = {},
    startY = 0
  }) {
    const bullish = side === 'up';
    const cfg = bullish ? this.config.ignition_spark_up : this.config.ignition_spark_down;
    if (!cfg) return;
    const val = bullish ? 1 : -1;
    const max = cfg.normalize?.max ?? 1;
    const scale = 40; // base bubble size
    const point = {
      x: cfg.zone ?? (bullish ? 0.5 : -0.5),
      y: startY,
      z: Math.min(Math.abs(strength) / max, 1) * scale,
      colorValue: val,
      color: cfg.color || '#f4d142',
      marker: { symbol: cfg.shape || 'triangle' },
      tag: cfg.label || (bullish ? 'Ignition Spark \u2191' : 'Ignition Spark \u2193'),
      xRaw: ts,
      strength: Math.abs(strength),
      meta: { ...cfg.meta, value: strength, ...meta }
    };
    this.chart.series[0].addPoint(point, true, false, { duration: 300 });
    const hcPoint = this.chart.series[0].data[this.chart.series[0].data.length - 1];
    this.points.push({ born: ts, startY, strength: point.strength, point: hcPoint });
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
    let dirty = false;
    for (let i = this.points.length - 1; i >= 0; i--) {
      const p = this.points[i];
      const age = (now - p.born) / 1000 + (p.startY || 0);
      if (age > 180) {
        if (typeof p.point.remove === 'function') p.point.remove(false);
        this.points.splice(i, 1);
        dirty = true;
      } else {
        if (typeof p.point.update === 'function') p.point.update({ y: age }, false);
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
