export default {
  askExhaustion: {
    id: 'askExhaustion',
    label: 'Ask exhaustion',
    zone: 0.5,
    color: '#17c964',
    shape: 'circle',
    normalization: { scale: 120 },
    tooltip: 'Ask-side exhaustion'
  },
  bidExhaustion: {
    id: 'bidExhaustion',
    label: 'Bid exhaustion',
    zone: -0.5,
    color: '#ff4d4d',
    shape: 'circle',
    normalization: { scale: 120 },
    tooltip: 'Bid-side exhaustion'
  },
  ignition_spark_up: {
    id: 'ignition_spark_up',
    label: 'Ignition Spark \u2191',
    zone: 0.5,
    color: '#17c964',
    shape: 'circle',
    normalize: { max: 1 },
    tooltip: 'Momentum-Ignition > +0.30 within seconds',
    meta: { side: 'bull', category: 'breakout' },
    implementationTip: 'momGauge > 0.30 && \u0394t \u2264 5 s',
    valueEffort: { value: 5, effort: 3 }
  },
  ignition_spark_down: {
    id: 'ignition_spark_down',
    label: 'Ignition Spark \u2193',
    zone: -0.5,
    color: '#ff4d4d',
    shape: 'circle',
    normalize: { max: 1 },
    tooltip: 'Momentum-Ignition < \u20130.30 inside seconds',
    meta: { side: 'bear', category: 'breakout' },
    implementationTip: 'momGauge < -0.30 && \u0394t \u2264 5 s',
    valueEffort: { value: 5, effort: 3 }
  },
  early_warn_ask: {
    id: 'early_warn_ask',
    label: 'Ask Exhaustion',
    zone: 0.70,
    color: '#3ad17d',
    shape: 'circle',
    normalize: { max: 1 },
    tooltip: 'Early-Warn flips positive: bids absorb, asks vanish',
    meta: { side: 'bull', category: 'reversal' }
  },
  early_warn_bid: {
    id: 'early_warn_bid',
    label: 'Bid Exhaustion',
    zone: -0.70,
    color: '#ff6e6e',
    shape: 'circle',
    normalize: { max: 1 },
    tooltip: 'Early-Warn flips negative: asks absorb, bids vanish',
    meta: { side: 'bear', category: 'reversal' }
  },
  smart_money_probe_up: {
    id: 'smart_money_probe_up',
    label: 'Smart-Money Probe \u2191',
    zone: 0.85,
    color: '#28c76f',
    shape: 'circle',
    normalize: { max: 1 },
    implementationTip: 'OB-CFD \u0394>0 & price \u0394<0 for \u22653 ticks',
    tooltip: 'Order book diverges bullishly',
    meta: { side: 'bull', category: 'reversal' }
  },
  smart_money_probe_down: {
    id: 'smart_money_probe_down',
    label: 'Smart-Money Probe \u2193',
    zone: -0.85,
    color: '#ff4d4d',
    shape: 'circle',
    normalize: { max: 1 },
    implementationTip: 'OB-CFD \u0394<0 & price \u0394>0 for \u22653 ticks',
    tooltip: 'Order book diverges bearishly',
    meta: { side: 'bear', category: 'reversal' }
  },

  buy_the_dip_earlywarn: {
    id: 'buy_the_dip_earlywarn',
    label: 'Buy-the-Dip Footprint',
    zone: 0.40,
    color: '#1abc9c',
    shape: 'circle',
    normalize: { max: 1 },
    tooltip: 'Early-Warn > 0 *after* pull-back',
    meta: { side: 'bull', category: 'continuation' },
    implementationTip: 'trigger once earlyWarn flips >0 after dip',
    valueEffort: { value: 4, effort: 3 }
  },

  sell_the_rally: {
    id: 'sell_the_rally',
    label: 'Sell-the-Rally Footprint',
    zone: -0.40,
    color: '#c0392b',
    shape: 'circle',
    normalize: { max: 1 },
    tooltip: 'Early-Warn < 0 after up-leg; ask absorption resumes',
    meta: { side: 'bear', category: 'continuation' },
    implementationTip: 'earlyWarnGauge < 0 post pop',
    valueEffort: { value: 4, effort: 3 }
  },

  flow_flip_squeeze_up: {
    id: 'flow_flip_squeeze_up',
    label: 'Squeeze \u2013 Shorts Trapped',
    zone: 0.65,
    shape: 'circle',
    color: '#41e084',
    normalize: { max: 1 },
    tooltip: 'Squeeze spike +0.4 \u2026 +1.0 within 5 s of large sell burst',
    meta: { side: 'bull', category: 'reversal' },
    implementationTip: "detectSqueeze(side='buy', thresh=0.4)"
  },

  flow_flip_squeeze_down: {
    id: 'flow_flip_squeeze_down',
    label: 'Squeeze \u2013 Longs Trapped',
    zone: -0.65,
    shape: 'circle',
    color: '#ea4d5c',
    normalize: { max: 1 },
    tooltip: 'Squeeze spike \u20130.4 \u2026 \u20131.0 within 5 s of large buy burst',
    meta: { side: 'bear', category: 'reversal' },
    implementationTip: "detectSqueeze(side='sell', thresh=-0.4)"
  },

  squeeze_warn_up: {
    id: 'squeeze_warn_up',
    label: 'Micro-Squeeze \u2191',
    zone: 0.55,
    shape: 'circle',
    color: '#41e084',
    normalize: { max: 1 },
    tooltip: 'First +0.20 Squeeze pulse\u2026',
    meta: { side: 'bull', category: 'reversal' },
    implementationTip: "detectSqueeze(side='buy', thresh=0.2)"
  },

  squeeze_warn_down: {
    id: 'squeeze_warn_down',
    label: 'Micro-Squeeze \u2193',
    zone: -0.55,
    shape: 'circle',
    color: '#ea4d5c',
    normalize: { max: 1 },
    tooltip: 'First \u20130.20 Squeeze pulse\u2026',
    meta: { side: 'bear', category: 'reversal' },
    implementationTip: "detectSqueeze(side='sell', thresh=-0.2)"
  },

  hidden_accumulation: {
    id: 'hidden_accumulation',
    label: 'Hidden Accumulation',
    zone: 0.75,
    color: '#2ecc71',
    shape: 'circle',
    normalize: { max: 1 },
    tooltip: 'Confirmation gauge > +0.10 = net bid absorptions',
    meta: { side: 'bull', category: 'reversal' },
    implementationTip: 'confirmationGauge > 0.10 for \u2265 N samples',
    valueEffort: { value: 5, effort: 4 }
  },

  hidden_distribution: {
    id: 'hidden_distribution',
    label: 'Hidden Distribution',
    zone: -0.75,
    color: '#ff5e5e',
    shape: 'circle',
    normalize: { max: 1 },
    tooltip: 'Confirmation gauge < \u20130.10 \u2192 BEAR',
    meta: { side: 'bear', category: 'reversal' },
    implementationTip: 'confirmationGauge < -0.10 for \u2265 N samples',
    valueEffort: { value: 5, effort: 4 }
  },

  controlled_pullback: {
    id: 'controlled_pullback',
    label: 'Controlled Dip',
    zone: 0.35,
    color: '#1abc9c',
    shape: 'circle',
    normalize: { max: 1 },
    tooltip: 'Imbalance falls but stays \u2265 \u20131\u03c3 & Confirmation \u2265 0',
    meta: { side: 'bull', category: 'continuation' },
    implementationTip: 'abs(deltaImb) < sigma && confirmation \u2265 0',
    valueEffort: { value: 3, effort: 2 }
  },

  controlled_pop: {
    id: 'controlled_pop',
    label: 'Controlled Pop',
    zone: -0.35,
    color: '#c0392b',
    shape: 'circle',
    normalize: { max: 1 },
    tooltip: 'Imbalance rises but \u2264 +1\u03c3 & Confirmation \u2264 0',
    meta: { side: 'bear', category: 'continuation' },
    implementationTip: 'deltaImb < sigma && confirmation \u2264 0',
    valueEffort: { value: 3, effort: 2 }
  },

  iceberg_event_up: {
    id: 'iceberg_event_up',
    label: 'Iceberg Buy',
    zone: 0.9,
    color: '#17c964',
    shape: 'circle',
    normalize: { max: 1 },
    tooltip: 'Hidden bid absorption: successive prints with <10% shown',
    meta: { side: 'bull', category: 'stealth' }
  },

  iceberg_event_down: {
    id: 'iceberg_event_down',
    label: 'Iceberg Sell',
    zone: -0.9,
    color: '#ff4d4d',
    shape: 'circle',
    normalize: { max: 1 },
    tooltip: 'Hidden ask absorption: successive prints with <10% shown',
    meta: { side: 'bear', category: 'stealth' }
  },

  mega_whale_up: {
    id: 'mega_whale_up',
    label: 'Whale Print \u25B2',
    zone: 0.95,
    color: '#4da6ff',
    shape: 'diamond',
    normalize: { max: 3 },
    tooltip: '\u2265 5\u00D7 adaptive big-print threshold (BUY)',
    meta: { side: 'bull', category: 'whale' },
    implementationTip: 'notional \u2265 5 * FALSE_ABS'
  },

  mega_whale_down: {
    id: 'mega_whale_down',
    label: 'Whale Print \u25BC',
    zone: -0.95,
    color: '#ff9100',
    shape: 'diamond',
    normalize: { max: 3 },
    tooltip: '\u2265 5\u00D7 adaptive big-print threshold (SELL)',
    meta: { side: 'bear', category: 'whale' },
    implementationTip: 'notional \u2265 5 * FALSE_ABS'
  },
  baby_whale_up: {
    id    : 'baby_whale_up',
    label : 'Baby Whale \u25B2',
    zone  : 0.88,
    color : '#3399ff',
    shape : 'diamond',
    normalize : { max: 1 },
    tooltip   : 'Single BUY print \u2265 $150 k',
    meta      : { side:'bull', category:'whale' },
    implementationTip : 'notional \u2265 150000'
  },

  baby_whale_down: {
    id    : 'baby_whale_down',
    label : 'Baby Whale \u25BC',
    zone  : -0.88,
    color : '#ff9933',
    shape : 'diamond',
    normalize : { max: 1 },
    tooltip   : 'Single SELL print \u2265 $150 k',
    meta      : { side:'bear', category:'whale' },
    implementationTip : 'notional \u2265 150000'
  },

  sweep_sell: {
    id    : 'sweep_sell',
    label : 'Sweep Sell',
    zone  : -0.85,
    color : '#ff4d4d',
    shape : 'triangle-down',
    normalize : { max: 1 },
    tooltip   : 'Aggressive sell sweep across \u2265 5 levels',
    meta      : { side:'bear', category:'forward-call' }
  },
  liquidity_vacuum_flush: {
    id    : 'liquidity_vacuum_flush',
    label : 'Vacuum \u25BC',
    zone  : -0.90,
    color : '#ff5252',
    shape : 'star',
    normalize : { max: 1 },
    tooltip: 'Thin book + net sells + downward ignition',
    meta  : { side: 'bear', category: 'forward-call' }
  },
  strong_bounce_incoming: {
    id: 'strong_bounce_incoming',
    label: 'Bounce \u25B2',
    zone: 0.90,
    color: '#28c76f',
    shape: 'star',
    normalize: { max: 1 },
    tooltip: 'All bounce gauges green (Confirm, EW, LaR, Momentum, MPD)',
    meta: { side: 'bull', category: 'forward-call' }
  }
};
