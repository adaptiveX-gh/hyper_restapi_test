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
  }
};
