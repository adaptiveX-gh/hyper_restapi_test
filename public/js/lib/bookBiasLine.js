/*───────────────────────────────────────────────────────────────*\
  bookBiasLine.js  –  Book-bias history + anomaly scatter overlay
  ▸ Pure ES-module (no global pollution)
  ▸ Depends only on   window.Highcharts
  ▸ Usage:

        import { BookBiasLine } from './js/bookBiasLine.js';

        const biasChart = new BookBiasLine('#biasLine');

        // 1️⃣  feed regular bias values
        biasChart.pushBias(Date.now(), +0.12);    // ts(ms), value(-1…+1)

        // 2️⃣  add “huge print” events
        biasChart.addAnomaly({
          ts      : Date.now(),
          side    : 'buy',          // or 'sell'
          size    : 850_000,        // raw notional for tooltip
          kind    : 'abs'           // 'abs' | 'exh'
        });

        // 3️⃣  whenever you bulk-replace the bias window (optional)
        biasChart.resetBiasSeries(myArrayOf [ts, value] );
  \*───────────────────────────────────────────────────────────────*/

export class BookBiasLine {
  #container;
  #chart          = null;
  #biasSeriesId   = 'bias';
  #eventSeriesId  = 'events';

  constructor (containerSelector = '#biasLine') {
    this.#container = containerSelector;
    this.#initChart();
  }

  /*─────────────────────────────────────────────────────────────*/
  /*  Public API                                                */
  /*─────────────────────────────────────────────────────────────*/

  /** Push *one* new [ts,value] pair (does its own redraw throttle) */
  pushBias (ts, value) {
    if (!Number.isFinite(value)) return;
    const s = this.#chart.get(this.#biasSeriesId);
    s.addPoint([ ts, value ], false, false);
    this.#maybeRedraw();
  }

  /** Replace the whole bias line (call VERY sparingly)            */
  resetBiasSeries (arrayOfTuples /* [[ts,val], …] */) {
    this.#chart.get(this.#biasSeriesId).setData(arrayOfTuples, false);
    this.#chart.redraw(false);
  }

  /** Drop an anomaly icon                                        */
  addAnomaly ({ ts, side, size, kind /* 'abs' | 'exh' */ }) {
    const bullish   = side === 'buy';
    const isAbs     = kind === 'abs';
    const series    = this.#chart.get(this.#eventSeriesId);

    series.addPoint({
      x       : ts,
      y       : this.#currentBiasValue(),
      anm     : isAbs ? 'Big ABS' : 'Big EXH',
      sideStr : bullish ? 'Bullish' : 'Bearish',
      size,
      marker  : {
        symbol    : isAbs ? 'triangle' : 'square',
        fillColor : bullish ? '#4dff88' : '#ff4d4d',
        lineColor : '#000',
        radius    : 7
      }
    }, false, false);

    this.#maybeRedraw();
  }

  /*─────────────────────────────────────────────────────────────*/
  /*  Internals                                                  */
  /*─────────────────────────────────────────────────────────────*/

  #initChart () {
    /* one-off Highcharts instantiation */
    this.#chart = Highcharts.chart(this.#container.replace(/^[#\.]/,''), {
      chart  : { type:'line', backgroundColor:'transparent', height:260 },
      title  : { text:'Book Bias Over Time' },
      xAxis  : { type:'datetime', tickInterval: 5 * 60 * 1000 },
      yAxis  : {
        min:-1, max:1,
        plotBands:[
          { from: 0.6,  to: 1,   color:'rgba(77,255,136,.10)' },
          { from:-1,    to:-0.6,color:'rgba(255,77,77,.10)'  }
        ],
        title: { text:null }
      },
      legend : { enabled:false },
      series : [{
        id   : this.#biasSeriesId,
        name : 'Bias',
        data : [],
        color: '#41967c',
        type : 'line',
        tooltip: { valueDecimals: 2 }
      },{
        id   : this.#eventSeriesId,
        name : 'Anomalies',
        type : 'scatter',
        data : [],
        yAxis: 0,
        tooltip : {
          pointFormatter () {
            return `<span style="color:${this.color}">●</span> <b>${this.anm}</b><br>`+
                   `${this.sideStr}, ${Highcharts.numberFormat(this.size,0)} notional<br>`+
                   `${Highcharts.dateFormat('%H:%M:%S', this.x)}`;
          }
        },
        marker : { symbol:'circle', radius:6, lineWidth:1, lineColor:'#000' },
        zIndex : 5
      }],
      credits : { enabled:false }
    });
  }

  /** last y-value of bias series, or 0 if empty */
  #currentBiasValue () {
    const s = this.#chart.get(this.#biasSeriesId);
    const last = s.yData.length ? s.yData[s.yData.length - 1] : 0;
    return last || 0;
  }

  /* simple redraw throttle (max 12 fps) */
  #lastDraw = 0;
  #maybeRedraw () {
    const now = performance.now();
    if (now - this.#lastDraw > 80) {
      this.#chart.redraw(false);
      this.#lastDraw = now;
    }
  }
}
