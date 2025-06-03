import { parseWeightsCsv, extractRowsFromTrade, injectTopTrade, addrWeights, topTrades } from '../src/topTraderFlow.js';

describe('topTraderFlow helpers', () => {
  test('parseWeightsCsv builds map', () => {
    const csv = 'address,weight\n0xabc,0.5\n0xdef,1.2';
    const map = parseWeightsCsv(csv);
    expect(map.size).toBe(2);
    expect(map.get('0xabc')).toBeCloseTo(0.5);
    expect(map.get('0xdef')).toBeCloseTo(1.2);
  });

  test('extractRowsFromTrade filters by address', () => {
    const csv = 'address,weight\n0xaaa,0.7';
    addrWeights.clear();
    addrWeights = parseWeightsCsv(csv);
    const trade = { users:['0xAaA','0xbbb'], px:'100', sz:'2', time:0 };
    const rows = extractRowsFromTrade(trade);
    expect(rows.length).toBe(1);
    expect(rows[0].trader).toBe('0xaaa');
    expect(rows[0].side).toBe('LONG');
  });

  test('bias +1 for buyer, -1 for seller', () => {
    addrWeights = new Map([['0xaaa',0.6], ['0xbbb',0.8]]);
    const trade = { users:['0xaaa','0xbbb'], px:'50', sz:'1', time:0 };
    const rows = extractRowsFromTrade(trade);
    const m = Object.fromEntries(rows.map(r => [r.trader, r.bias]));
    expect(m['0xaaa']).toBe(1);
    expect(m['0xbbb']).toBe(-1);
  });

  test('injectTopTrade records rows', () => {
    addrWeights = new Map([['0xabc', 1]]);
    topTrades.length = 0;
    const trade = { users:['0xAbC','0xdef'], px:'10', sz:'2', time:0 };
    const rows = injectTopTrade(trade);
    expect(rows.length).toBe(1);
    expect(topTrades[0].trader).toBe('0xabc');
  });
});
