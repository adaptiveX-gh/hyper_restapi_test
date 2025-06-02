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
    shape: 'triangle',
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
    shape: 'triangle',
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
    shape: 'triangle',
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
    shape: 'triangle',
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
    shape: 'diamond',
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
    shape: 'diamond',
    color: '#ea4d5c',
    normalize: { max: 1 },
    tooltip: 'Squeeze spike \u20130.4 \u2026 \u20131.0 within 5 s of large buy burst',
    meta: { side: 'bear', category: 'reversal' },
    implementationTip: "detectSqueeze(side='sell', thresh=-0.4)"
  },

  hidden_accumulation: {
    id: 'hidden_accumulation',
    label: 'Hidden Accumulation',
    zone: 0.75,
    color: '#2ecc71',
    shape: 'triangle',
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
    shape: 'triangle',
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
    shape: 'square',
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
    shape: 'square',
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
    shape: 'square',
    normalize: { max: 1 },
    tooltip: 'Hidden bid absorption: successive prints with <10% shown',
    meta: { side: 'bull', category: 'stealth' }
  },

  iceberg_event_down: {
    id: 'iceberg_event_down',
    label: 'Iceberg Sell',
    zone: -0.9,
    color: '#ff4d4d',
    shape: 'square',
    normalize: { max: 1 },
    tooltip: 'Hidden ask absorption: successive prints with <10% shown',
    meta: { side: 'bear', category: 'stealth' }
  }
};
