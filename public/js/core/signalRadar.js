import config from './signalConfig.js';
import { PongGame } from './pong.js';

export class SignalRadar {
  constructor(containerId, cfg = config) {
    this.points = [];
    this.namedPoints = new Map();
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
      title: { text: null },
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
      yAxis: [{
        min: 0,
        max: 200,
        reversed: true,
        gridLineWidth: 1,
        labels: { formatter() { return this.value + ' s'; } },
        title: { text: 'Age of signal' }
      }, {
        min: 0,
        max: 200,
        reversed: false,
        gridLineWidth: 1,
        labels: { formatter() { return this.value + ' s'; } },
        title: { text: 'Age of signal' },
        opposite: true
      }],
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
        name: 'Short Signals',
        yAxis: 0,
        colorKey: 'colorValue',
        data: [],
        point: {
          events: {
            click: function(){
              this.series.chart.options.custom.radar.highlight(this);
            }
          }
        }
      }, {
        name: 'Long Signals',
        yAxis: 1,
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
    this.pong = new PongGame(this.chart);
    this.timer = setInterval(() => this.tick(), 1000);
  }

  updatePong(data) {
    if (this.pong) this.pong.update(data);
  }

  addProbe({ stateScore=0, strength=0.3, ts=Date.now(), meta={}, startY=0, colorValue=null }) {
    const cfg  = this.config.probe || {};
    const val  = colorValue ?? stateScore;
    const sign = Math.sign(val);
    const seriesIdx = sign >= 0 ? 1 : 0;
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
    this.chart.series[seriesIdx].addPoint(point, true, false, { duration: 300 });
    const hcPoint = this.chart.series[seriesIdx].data[this.chart.series[seriesIdx].data.length - 1];
    this.points.push({ born: ts, startY, strength, point: hcPoint });
    if (this.points.length > 400) {
      this.points.sort((a,b)=>a.strength-b.strength);
      const excess = this.points.splice(0, this.points.length-400);
      excess.forEach(p=>{
        if (p.point.remove) p.point.remove(false);
      });
      this.chart.redraw(false);
    }
  }

  addEarlyWarn({
    strength = 0.1,
    ts = Date.now(),
    side = 'ask',
    meta = {},
    startY = 0
  }) {
    const bullish = side === 'ask';
    const key = bullish ? 'early_warn_ask' : 'early_warn_bid';
    const cfg = this.config[key];
    if (!cfg) {
      console.warn('Missing config for', key);
      return;
    }
    const val = bullish ? 1 : -1;
    const max = cfg.normalize?.max ?? 1;
    const scale = 40; // base bubble size
    const zone = cfg.zone ?? (bullish ? 0.7 : -0.7);
    const point = {
      x: zone,
      y: startY,
      z: Math.min(Math.abs(strength) / max, 1) * scale,
      colorValue: val,
      color: cfg.color || (bullish ? '#17c964' : '#ff4d4d'),
      marker: { symbol: cfg.shape || 'circle' },
      tag: cfg.label || (bullish ? 'Ask Exhaustion' : 'Bid Exhaustion'),
      xRaw: ts,
      strength: Math.abs(strength),
      meta: { ...cfg.meta, value: strength, ...meta }
    };
    if (point.strength <= 0) return;
    const idx = bullish ? 1 : 0;
    this.chart.series[idx].addPoint(point, true, false, { duration: 300 });
    const hcPoint = this.chart.series[idx].data[this.chart.series[idx].data.length - 1];
    this.points.push({ born: ts, startY, strength: point.strength, point: hcPoint });
    if (this.points.length > 400) {
      this.points.sort((a, b) => a.strength - b.strength);
      const excess = this.points.splice(0, this.points.length - 400);
      excess.forEach(p => {
        if (p.point.remove) p.point.remove(false);
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
    const idxSeries = bullish ? 1 : 0;
    this.chart.series[idxSeries].addPoint(point, true, false, { duration: 300 });
    const hcPoint = this.chart.series[idxSeries].data[this.chart.series[idxSeries].data.length - 1];
    this.points.push({ born: ts, startY, strength: point.strength, point: hcPoint });
    if (this.points.length > 400) {
      this.points.sort((a, b) => a.strength - b.strength);
      const excess = this.points.splice(0, this.points.length - 400);
      excess.forEach(p => {
        if (p.point.remove) p.point.remove(false);
      });
      this.chart.redraw(false);
    }
  }

  addBuyTheDipEarlyWarn({
    strength = 0.1,
    ts = Date.now(),
    meta = {},
    startY = 0
  }) {
    const cfg = this.config.buy_the_dip_earlywarn;
    if (!cfg) {
      console.warn('Missing config for buy_the_dip_earlywarn');
      return;
    }
    const val = 1;
    const max = cfg.normalize?.max ?? 1;
    const scale = 40;
    const point = {
      x: cfg.zone ?? 0.4,
      y: startY,
      z: Math.min(Math.abs(strength) / max, 1) * scale,
      colorValue: val,
      color: cfg.color || '#1abc9c',
      marker: { symbol: cfg.shape || 'circle' },
      tag: cfg.label || 'Buy-the-Dip Footprint',
      xRaw: ts,
      strength: Math.abs(strength),
      meta: { ...cfg.meta, value: strength, ...meta }
    };
    if (point.strength <= 0) return;
    const idx = 1;
    this.chart.series[idx].addPoint(point, true, false, { duration: 300 });
    const hcPoint = this.chart.series[idx].data[this.chart.series[idx].data.length - 1];
    this.points.push({ born: ts, startY, strength: point.strength, point: hcPoint });
    if (this.points.length > 400) {
      this.points.sort((a, b) => a.strength - b.strength);
      const excess = this.points.splice(0, this.points.length - 400);
      excess.forEach(p => {
        if (p.point.remove) p.point.remove(false);
      });
      this.chart.redraw(false);
    }
  }

  addSellTheRally({
    strength = 0.1,
    ts = Date.now(),
    meta = {},
    startY = 0
  }) {
    const cfg = this.config.sell_the_rally;
    if (!cfg) {
      console.warn('Missing config for sell_the_rally');
      return;
    }
    const val = -1;
    const max = cfg.normalize?.max ?? 1;
    const scale = 40;
    const point = {
      x: cfg.zone ?? -0.4,
      y: startY,
      z: Math.min(Math.abs(strength) / max, 1) * scale,
      colorValue: val,
      color: cfg.color || '#c0392b',
      marker: { symbol: cfg.shape || 'circle' },
      tag: cfg.label || 'Sell-the-Rally Footprint',
      xRaw: ts,
      strength: Math.abs(strength),
      meta: { ...cfg.meta, value: strength, ...meta }
    };
    if (point.strength <= 0) return;
    const idx = 0;
    this.chart.series[idx].addPoint(point, true, false, { duration: 300 });
    const hcPoint = this.chart.series[idx].data[this.chart.series[idx].data.length - 1];
    this.points.push({ born: ts, startY, strength: point.strength, point: hcPoint });
    if (this.points.length > 400) {
      this.points.sort((a, b) => a.strength - b.strength);
      const excess = this.points.splice(0, this.points.length - 400);
      excess.forEach(p => {
        if (p.point.remove) p.point.remove(false);
      });
      this.chart.redraw(false);
    }
  }

  addFlowFlipSqueezeUp({
    strength = 0.1,
    ts = Date.now(),
    meta = {},
    startY = 0
  }) {
    const cfg = this.config.flow_flip_squeeze_up;
    if (!cfg) {
      console.warn('Missing config for flow_flip_squeeze_up');
      return;
    }
    const val = 1;
    const max = cfg.normalize?.max ?? 1;
    const scale = 40;
    const point = {
      x: cfg.zone ?? 0.65,
      y: startY,
      z: Math.min(Math.abs(strength) / max, 1) * scale,
      colorValue: val,
      color: cfg.color || '#41e084',
      marker: { symbol: cfg.shape || 'diamond' },
      tag: cfg.label || 'Squeeze – Shorts Trapped',
      xRaw: ts,
      strength: Math.abs(strength),
      meta: { ...cfg.meta, value: strength, ...meta }
    };
    if (point.strength <= 0) return;
    const idx = 1;
    this.chart.series[idx].addPoint(point, true, false, { duration: 300 });
    const hcPoint = this.chart.series[idx].data[this.chart.series[idx].data.length - 1];
    this.points.push({ born: ts, startY, strength: point.strength, point: hcPoint });
    if (this.points.length > 400) {
      this.points.sort((a, b) => a.strength - b.strength);
      const excess = this.points.splice(0, this.points.length - 400);
      excess.forEach(p => {
        if (p.point.remove) p.point.remove(false);
      });
      this.chart.redraw(false);
    }
  }

  addFlowFlipSqueezeDown({
    strength = 0.1,
    ts = Date.now(),
    meta = {},
    startY = 0
  }) {
    const cfg = this.config.flow_flip_squeeze_down;
    if (!cfg) {
      console.warn('Missing config for flow_flip_squeeze_down');
      return;
    }
    const val = -1;
    const max = cfg.normalize?.max ?? 1;
    const scale = 40;
    const point = {
      x: cfg.zone ?? -0.65,
      y: startY,
      z: Math.min(Math.abs(strength) / max, 1) * scale,
      colorValue: val,
      color: cfg.color || '#ea4d5c',
      marker: { symbol: cfg.shape || 'diamond' },
      tag: cfg.label || 'Squeeze – Longs Trapped',
      xRaw: ts,
      strength: Math.abs(strength),
      meta: { ...cfg.meta, value: strength, ...meta }
    };
    if (point.strength <= 0) return;
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

  addSqueezeWarnUp({
    strength = 0.1,
    ts = Date.now(),
    meta = {},
    startY = 0
  }) {
    const cfg = this.config.squeeze_warn_up;
    if (!cfg) {
      console.warn('Missing config for squeeze_warn_up');
      return;
    }
    const val = 1;
    const max = cfg.normalize?.max ?? 1;
    const scale = 40;
    const point = {
      x: cfg.zone ?? 0.55,
      y: startY,
      z: Math.min(Math.abs(strength) / max, 1) * scale,
      colorValue: val,
      color: cfg.color || '#41e084',
      marker: { symbol: cfg.shape || 'diamond' },
      tag: cfg.label || 'Micro-Squeeze \u2191',
      xRaw: ts,
      strength: Math.abs(strength),
      meta: { ...cfg.meta, value: strength, ...meta }
    };
    if (point.strength <= 0) return;
    const idx = 1;
    this.chart.series[idx].addPoint(point, true, false, { duration: 300 });
    const hcPoint = this.chart.series[idx].data[this.chart.series[idx].data.length - 1];
    this.points.push({ born: ts, startY, strength: point.strength, point: hcPoint });
    if (this.points.length > 400) {
      this.points.sort((a, b) => a.strength - b.strength);
      const excess = this.points.splice(0, this.points.length - 400);
      excess.forEach(p => { if (p.point.remove) p.point.remove(false); });
      this.chart.redraw(false);
    }
  }

  addSqueezeWarnDown({
    strength = 0.1,
    ts = Date.now(),
    meta = {},
    startY = 0
  }) {
    const cfg = this.config.squeeze_warn_down;
    if (!cfg) {
      console.warn('Missing config for squeeze_warn_down');
      return;
    }
    const val = -1;
    const max = cfg.normalize?.max ?? 1;
    const scale = 40;
    const point = {
      x: cfg.zone ?? -0.55,
      y: startY,
      z: Math.min(Math.abs(strength) / max, 1) * scale,
      colorValue: val,
      color: cfg.color || '#ea4d5c',
      marker: { symbol: cfg.shape || 'diamond' },
      tag: cfg.label || 'Micro-Squeeze \u2193',
      xRaw: ts,
      strength: Math.abs(strength),
      meta: { ...cfg.meta, value: strength, ...meta }
    };
    if (point.strength <= 0) return;
    const idx = 0;
    this.chart.series[idx].addPoint(point, true, false, { duration: 300 });
    const hcPoint = this.chart.series[idx].data[this.chart.series[idx].data.length - 1];
    this.points.push({ born: ts, startY, strength: point.strength, point: hcPoint });
    if (this.points.length > 400) {
      this.points.sort((a, b) => a.strength - b.strength);
      const excess = this.points.splice(0, this.points.length - 400);
      excess.forEach(p => { if (p.point.remove) p.point.remove(false); });
      this.chart.redraw(false);
    }
  }

  addHiddenAccumulation({
    strength = 0.1,
    ts = Date.now(),
    meta = {},
    startY = 0
  }) {
    const cfg = this.config.hidden_accumulation;
    if (!cfg) {
      console.warn('Missing config for hidden_accumulation');
      return;
    }
    const val = 1;
    const max = cfg.normalize?.max ?? 1;
    const scale = 40;
    const point = {
      x: cfg.zone ?? 0.75,
      y: startY,
      z: Math.min(Math.abs(strength) / max, 1) * scale,
      colorValue: val,
      color: cfg.color || '#2ecc71',
      marker: { symbol: cfg.shape || 'triangle' },
      tag: cfg.label || 'Hidden Accumulation',
      xRaw: ts,
      strength: Math.abs(strength),
      meta: { ...cfg.meta, value: strength, ...meta }
    };
    if (point.strength <= 0) return;
    const idx = 1;
    this.chart.series[idx].addPoint(point, true, false, { duration: 300 });
    const hcPoint = this.chart.series[idx].data[this.chart.series[idx].data.length - 1];
    this.points.push({ born: ts, startY, strength: point.strength, point: hcPoint });
    if (this.points.length > 400) {
      this.points.sort((a, b) => a.strength - b.strength);
      const excess = this.points.splice(0, this.points.length - 400);
      excess.forEach(p => {
        if (p.point.remove) p.point.remove(false);
      });
      this.chart.redraw(false);
    }
  }

  addHiddenDistribution({
    strength = 0.1,
    ts = Date.now(),
    meta = {},
    startY = 0
  }) {
    const cfg = this.config.hidden_distribution;
    if (!cfg) {
      console.warn('Missing config for hidden_distribution');
      return;
    }
    const val = -1;
    const max = cfg.normalize?.max ?? 1;
    const scale = 40;
    const point = {
      x: cfg.zone ?? -0.75,
      y: startY,
      z: Math.min(Math.abs(strength) / max, 1) * scale,
      colorValue: val,
      color: cfg.color || '#ff5e5e',
      marker: { symbol: cfg.shape || 'triangle' },
      tag: cfg.label || 'Hidden Distribution',
      xRaw: ts,
      strength: Math.abs(strength),
      meta: { ...cfg.meta, value: strength, ...meta }
    };
    if (point.strength <= 0) return;
    const idx = 0;
    this.chart.series[idx].addPoint(point, true, false, { duration: 300 });
    const hcPoint = this.chart.series[idx].data[this.chart.series[idx].data.length - 1];
    this.points.push({ born: ts, startY, strength: point.strength, point: hcPoint });
    if (this.points.length > 400) {
      this.points.sort((a, b) => a.strength - b.strength);
      const excess = this.points.splice(0, this.points.length - 400);
      excess.forEach(p => {
        if (p.point.remove) p.point.remove(false);
      });
      this.chart.redraw(false);
    }
  }

  addControlledPullback({
    strength = 0.1,
    ts = Date.now(),
    meta = {},
    startY = 0
  }) {
    const cfg = this.config.controlled_pullback;
    if (!cfg) {
      console.warn('Missing config for controlled_pullback');
      return;
    }
    const val = 1;
    const max = cfg.normalize?.max ?? 1;
    const scale = 40;
    const point = {
      x: cfg.zone ?? 0.35,
      y: startY,
      z: Math.min(Math.abs(strength) / max, 1) * scale,
      colorValue: val,
      color: cfg.color || '#1abc9c',
      marker: { symbol: cfg.shape || 'square' },
      tag: cfg.label || 'Controlled Dip',
      xRaw: ts,
      strength: Math.abs(strength),
      meta: { ...cfg.meta, value: strength, ...meta }
    };
    if (point.strength <= 0) return;
    const idx = 1;
    this.chart.series[idx].addPoint(point, true, false, { duration: 300 });
    const hcPoint = this.chart.series[idx].data[this.chart.series[idx].data.length - 1];
    this.points.push({ born: ts, startY, strength: point.strength, point: hcPoint });
    if (this.points.length > 400) {
      this.points.sort((a, b) => a.strength - b.strength);
      const excess = this.points.splice(0, this.points.length - 400);
      excess.forEach(p => {
        if (p.point.remove) p.point.remove(false);
      });
      this.chart.redraw(false);
    }
  }

  addControlledPop({
    strength = 0.1,
    ts = Date.now(),
    meta = {},
    startY = 0
  }) {
    const cfg = this.config.controlled_pop;
    if (!cfg) {
      console.warn('Missing config for controlled_pop');
      return;
    }
    const val = -1;
    const max = cfg.normalize?.max ?? 1;
    const scale = 40;
    const point = {
      x: cfg.zone ?? -0.35,
      y: startY,
      z: Math.min(Math.abs(strength) / max, 1) * scale,
      colorValue: val,
      color: cfg.color || '#c0392b',
      marker: { symbol: cfg.shape || 'square' },
      tag: cfg.label || 'Controlled Pop',
      xRaw: ts,
      strength: Math.abs(strength),
      meta: { ...cfg.meta, value: strength, ...meta }
    };
    if (point.strength <= 0) return;
    const idx = 0;
    this.chart.series[idx].addPoint(point, true, false, { duration: 300 });
    const hcPoint = this.chart.series[idx].data[this.chart.series[idx].data.length - 1];
    this.points.push({ born: ts, startY, strength: point.strength, point: hcPoint });
    if (this.points.length > 400) {
      this.points.sort((a, b) => a.strength - b.strength);
      const excess = this.points.splice(0, this.points.length - 400);
      excess.forEach(p => {
        if (p.point.remove) p.point.remove(false);
      });
      this.chart.redraw(false);
    }
  }

  addIcebergEventUp({ strength = 0.1, ts = Date.now(), meta = {}, startY = 0 }) {
    const cfg = this.config.iceberg_event_up;
    if (!cfg) {
      console.warn('Missing config for iceberg_event_up');
      return;
    }
    const val = 1;
    const max = cfg.normalize?.max ?? 1;
    const scale = 40;
    const point = {
      x: cfg.zone ?? 0.9,
      y: startY,
      z: Math.min(Math.abs(strength) / max, 1) * scale,
      colorValue: val,
      color: cfg.color || '#17c964',
      marker: { symbol: cfg.shape || 'square' },
      tag: cfg.label || 'Iceberg Buy',
      xRaw: ts,
      strength: Math.abs(strength),
      meta: { ...cfg.meta, value: strength, ...meta }
    };
    if (point.strength <= 0) return;
    this.chart.series[1].addPoint(point, true, false, { duration: 300 });
    const hcPoint = this.chart.series[1].data[this.chart.series[1].data.length - 1];
    this.points.push({ born: ts, startY, strength: point.strength, point: hcPoint });
    if (this.points.length > 400) {
      this.points.sort((a, b) => a.strength - b.strength);
      const excess = this.points.splice(0, this.points.length - 400);
      excess.forEach(p => { if (p.point.remove) p.point.remove(false); });
      this.chart.redraw(false);
    }
  }

  addIcebergEventDown({ strength = 0.1, ts = Date.now(), meta = {}, startY = 0 }) {
    const cfg = this.config.iceberg_event_down;
    if (!cfg) {
      console.warn('Missing config for iceberg_event_down');
      return;
    }
    const val = -1;
    const max = cfg.normalize?.max ?? 1;
    const scale = 40;
    const point = {
      x: cfg.zone ?? -0.9,
      y: startY,
      z: Math.min(Math.abs(strength) / max, 1) * scale,
      colorValue: val,
      color: cfg.color || '#ff4d4d',
      marker: { symbol: cfg.shape || 'square' },
      tag: cfg.label || 'Iceberg Sell',
      xRaw: ts,
      strength: Math.abs(strength),
      meta: { ...cfg.meta, value: strength, ...meta }
    };
    if (point.strength <= 0) return;
    this.chart.series[0].addPoint(point, true, false, { duration: 300 });
    const hcPoint = this.chart.series[0].data[this.chart.series[0].data.length - 1];
    this.points.push({ born: ts, startY, strength: point.strength, point: hcPoint });
    if (this.points.length > 400) {
      this.points.sort((a, b) => a.strength - b.strength);
      const excess = this.points.splice(0, this.points.length - 400);
      excess.forEach(p => { if (p.point.remove) p.point.remove(false); });
      this.chart.redraw(false);
    }
  }

  addOrUpdateProbe({ id, stateScore = 0, strength = 0.1, ts = Date.now(), meta = {}, startY = 0 }) {
    const cfg = this.config[id];
    if (!cfg) {
      console.warn('Missing config for', id);
      return;
    }
    const bullish = id.endsWith('_up');
    const val = bullish ? 1 : -1;
    const max = cfg.normalize?.max ?? 1;
    const scale = 40;
    const zone = cfg.zone ?? (bullish ? 0.85 : -0.85);
    const props = {
      x: zone,
      y: startY,
      z: Math.min(Math.abs(strength) / max, 1) * scale,
      colorValue: val,
      color: cfg.color || (bullish ? '#28c76f' : '#ff4d4d'),
      marker: { symbol: cfg.shape || 'triangle' },
      tag: cfg.label || (bullish ? 'Smart-Money Probe \u2191' : 'Smart-Money Probe \u2193'),
      xRaw: ts,
      strength: Math.abs(strength),
      meta: { ...cfg.meta, value: strength, ...meta }
    };

    const existing = this.namedPoints.get(id);
    const idx = bullish ? 1 : 0;
    if (existing) {
      Object.assign(existing, { born: ts, startY, strength: props.strength });
      if (typeof existing.point.update === 'function') {
        existing.point.update(props, false);
      }
      this.chart.redraw(false);
    } else {
      this.chart.series[idx].addPoint(props, true, false, { duration: 300 });
      const hcPoint = this.chart.series[idx].data[this.chart.series[idx].data.length - 1];
      const rec = { id, born: ts, startY, strength: props.strength, point: hcPoint };
      this.points.push(rec);
      this.namedPoints.set(id, rec);
      if (this.points.length > 400) {
        this.points.sort((a, b) => a.strength - b.strength);
        const excess = this.points.splice(0, this.points.length - 400);
        excess.forEach(p => {
          if (p.point.remove) p.point.remove(false);
          if (p.id) this.namedPoints.delete(p.id);
        });
        this.chart.redraw(false);
      }
    }
  }

  tick() {
    const now = Date.now();
    let dirty = false;
    for (let i = this.points.length - 1; i >= 0; i--) {
      const p = this.points[i];
      const age = (now - p.born) / 1000 + (p.startY || 0);
      if (age > 200) {
        if (typeof p.point.remove === 'function') p.point.remove(false);
        this.points.splice(i, 1);
        if (p.id && this.namedPoints.get(p.id)?.point === p.point) {
          this.namedPoints.delete(p.id);
        }
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
    this.chart.series.forEach(s => {
      s.data.forEach(p => {
        const same = this.selectedSign == null || Math.sign(p.colorValue || 0) === this.selectedSign;
        p.update({ marker: { fillOpacity: same ? 0.85 : 0.2, lineWidth: same && this.selectedSign != null ? 2 : 0 } }, false);
      });
    });
    this.chart.redraw(false);
  }

  destroy() { clearInterval(this.timer); }
}
