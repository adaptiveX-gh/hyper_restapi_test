import { classifyTrade, TapeFlowAnalyzer } from '../absorb/tapeFlow.js';

const baseBook = {
  bids: [[100, 2]],
  asks: [[101, 1]]
};

const tradeBuy = { side: 'A', sz: 1, px: 101 };
const tradeSell = { side: 'B', sz: 1, px: 100 };

test('classifies absorption with iceberg flag', () => {
  const post = { bids: [[100, 2]], asks: [[101, 0.5]] };
  const event = classifyTrade(tradeBuy, baseBook, post);
  expect(event.type).toBe('absorption');
  expect(event.side).toBe('buy');
  expect(event.iceberg).toBe(true);
});

test('classifies exhaustion', () => {
  const post = { bids: [[100, 3]], asks: [[101, 1]] };
  const event = classifyTrade(tradeSell, baseBook, post);
  expect(event.type).toBe('exhaustion');
  expect(event.side).toBe('sell');
});

test('updates rolling bias via analyzer', () => {
  const post = { bids: [[100, 2]], asks: [[101, 0.5]] };
  const analyzer = new TapeFlowAnalyzer(3);
  analyzer.process(tradeBuy, baseBook, post);
  expect(analyzer.getBias()).toBeCloseTo(1);
});
