export default {
  probe: {
    id: 'probe',
    label: 'Probe',
    zone: 0,
    color: { bull: '#17c964', bear: '#ff4d4d' },
    shape: 'circle',
    normalization: { scale: 35 },
    tooltip: 'Depth probe event'
  },
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
    color: '#f4d142',
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
    color: '#f4d142',
    shape: 'triangle',
    normalize: { max: 1 },
    tooltip: 'Momentum-Ignition < \u20130.30 inside seconds',
    meta: { side: 'bear', category: 'breakout' },
    implementationTip: 'momGauge < -0.30 && \u0394t \u2264 5 s',
    valueEffort: { value: 5, effort: 3 }
  }
};
