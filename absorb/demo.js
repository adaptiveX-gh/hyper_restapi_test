import { TapeFlowAnalyzer } from './tapeFlow.js';

// Simple demo using fabricated data
const analyzer = new TapeFlowAnalyzer(5);

const pre = {
  bids: [[100, 2]],
  asks: [[101, 1]]
};

const post = {
  bids: [[100, 2]],
  asks: [[101, 0.5]]
};

const trade = { side: 'A', sz: 0.6, px: 101 };

analyzer.process(trade, pre, post);
console.log('Rolling bias:', analyzer.getBias().toFixed(2));
