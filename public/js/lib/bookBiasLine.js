/*───────────────────────────────────────────────────────────────*\
  bookBiasLine.js  –  Book-bias history line chart
  ▸ Pure ES-module (no global pollution)
  ▸ Depends only on   window.Highcharts
  ▸ Usage:

        import { BookBiasLine } from './js/bookBiasLine.js';

        const biasChart = new BookBiasLine('#biasLine');

        // 1️⃣  feed regular bias values
        biasChart.pushBias(Date.now(), +0.12);        // ts(ms), value(-1…+1)

        // 2️⃣  replace the full series (rare)
        biasChart.resetBiasSeries(myArrayOf [ts, value] );
\*───────────────────────────────────────────────────────────────*/

export class BookBiasLine {
  /****************************************************************
   *  PRIVATE FIELDS
   ****************************************************************/
  #containerSelector;
  #chart        = null;
  #biasSeriesId = 'bias';

  /* ── redraw throttle (max ≈12 fps) ────────────────────────── */
  #lastDraw       = 0;
  static #REDRAW_COOLDOWN_MS = 80;

  /****************************************************************
   *  C T O R
   ****************************************************************/
  constructor (containerSelector = '#biasLine') {
    this.#containerSelector = containerSelector;
    this.#initChart();
  }

  /****************************************************************
   *  P U B L I C   A P I
   ****************************************************************/

  /** Append one [timestamp, value] pair */
  pushBias (ts, value) {
    if (!Number.isFinite(value)) return;
    this.#chart.get(this.#biasSeriesId)
               .addPoint([ts, value], false, false);
    this.#maybeRedraw();
  }

  /** Replace the whole bias line (only use when you *must*) */
  resetBiasSeries (arr /* [[ts,val], …] */) {
    const sorted = Array.isArray(arr) ? [...arr].sort((a, b) => a[0] - b[0]) : [];
    this.#chart.get(this.#biasSeriesId).setData(sorted, false);
    this.#chart.redraw(false);
  }



  /****************************************************************
   *  I N T E R N A L S
   ****************************************************************/

  /* ---- Highcharts bootstrap (once) --------------------------- */
  #initChart () {
    this.#chart = Highcharts.stockChart(
      this.#containerSelector.replace(/^[#\.]/, ''),   // id only
      {
        chart : {
          type           : 'line',
          backgroundColor: 'transparent',
          height         : 260
        },
        title : { text:'Book Bias Over Time' },

        xAxis : {
          type        : 'datetime',
          tickInterval: 5 * 60 * 1000          // 5 min
        },

        yAxis : {
          min : -1,
          max :  1,
          title: { text:null },
          plotBands : [
            { from:  0.6, to:  1.0, color:'rgba( 77,255,136,.10)' },
            { from: -1.0, to: -0.6, color:'rgba(255, 77, 77,.10)' }
          ]
        },

        legend  : { enabled:false },
        credits : { enabled:false },

        // Enable navigator and range selector just like the CFD chart
        navigator: { enabled: true },
        rangeSelector: {
          enabled: true,
          inputEnabled: false,
          buttons: [
            { type: 'minute', count: 1,  text: '1m' },
            { type: 'minute', count: 5,  text: '5m' },
            { type: 'minute', count: 15, text: '15m' },
            { type: 'minute', count: 60, text: '60m' },
            { type: 'all',    text: 'All' }
          ],
          selected: 1
        },

        series : [
          /* ① smooth bias line */
          {
            id   : this.#biasSeriesId,
            name : 'Bias',
            data : [],
            color: '#41967c',
            tooltip: { valueDecimals: 2 }
          }

          /* ② placeholder for historical events removed */
        ]
      }
    );
  }

  /** Most recent y-value of the bias series (0 if empty) */
  #currentBiasValue () {
    /* guard against “no data yet” ──────── */
    const s = this.#chart.get(this.#biasSeriesId);
    if (!s || !Array.isArray(s.yData) || !s.yData.length) return 0;

    const last = s.yData[s.yData.length - 1];
    return Number.isFinite(last) ? last : 0;
  }

  /** Throttled redraw helper */
  #maybeRedraw () {
    const now = performance.now();
    if (now - this.#lastDraw > BookBiasLine.#REDRAW_COOLDOWN_MS) {
      this.#chart.redraw(false);
      this.#lastDraw = now;
    }
  }
}

/* ── Named export only (no helper functions) ─────────────────── */
export default BookBiasLine;
