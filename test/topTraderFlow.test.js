import axios from 'axios';
import {
  parseWeightsCsv,
  extractRowsFromTrade,
  injectTopTrade,
  addrWeights,
  topTrades,
  loadWeights
} from '../src/topTraderFlow.js';

jest.mock('axios');

describe('topTraderFlow helpers', () => {
  test('parseWeightsCsv builds map', () => {
    const csv = 'address,weight\n0xabc,0.5\n0xdef,1.2';
    const map = parseWeightsCsv(csv);
    expect(map.size).toBe(2);
    expect(map.get('0xabc')).toBeCloseTo(0.5);
    expect(map.get('0xdef')).toBeCloseTo(1.2);
  });

  test('extractRowsFromTrade includes both sides', () => {
    const csv = 'address,weight\n0xaaa,0.7';
    addrWeights.clear();
    addrWeights = parseWeightsCsv(csv);
    const trade = { users:['0xAaA','0xbbb'], px:'100', sz:'2', time:0 };
    const rows = extractRowsFromTrade(trade);
    expect(rows.length).toBe(2);
    expect(rows[0].trader).toBe('0xaaa');
    expect(rows[0].side).toBe('LONG');
    expect(rows[1].trader).toBe('0xbbb');
    expect(rows[1].weight).toBe(0);
  });

  test('bias +1 for buyer, -1 for seller', () => {
    addrWeights = new Map([['0xaaa',0.6], ['0xbbb',0.8]]);
    const trade = { users:['0xaaa','0xbbb'], px:'50', sz:'1', time:0 };
    const rows = extractRowsFromTrade(trade);
    const m = Object.fromEntries(rows.map(r => [r.trader, r.bias]));
    expect(m['0xaaa']).toBe(1);
    expect(m['0xbbb']).toBe(-1);
  });

  test('injectTopTrade returns both traders', () => {
    addrWeights = new Map([['0xabc', 1]]);
    topTrades.length = 0;
    const trade = { users:['0xAbC','0xdef'], px:'10', sz:'2', time:0 };
    const rows = injectTopTrade(trade);
    expect(rows.length).toBe(2);
    const traders = rows.map(r => r.trader);
    expect(traders).toContain('0xabc');
    expect(traders).toContain('0xdef');
  });

  test('loadWeights uses JSON from env variable', async () => {
    axios.get.mockResolvedValueOnce({ data: { '0xABC': '1', '0xdef': 0.4 } });
    process.env.GS_TOP_TRADER_WEIGHTS_URL = 'http://example.com/json';
    addrWeights.clear();
    await loadWeights();
    expect(axios.get).toHaveBeenCalledWith('http://example.com/json', { timeout: 10000 });
    expect(addrWeights.get('0xabc')).toBeCloseTo(1);
    expect(addrWeights.get('0xdef')).toBeCloseTo(0.4);
    delete process.env.GS_TOP_TRADER_WEIGHTS_URL;
  });

  test('loadWeights falls back to CSV', async () => {
    axios.get.mockResolvedValueOnce({ data: 'address,weight\n0xaaa,2' });
    addrWeights.clear();
    await loadWeights('http://csv.test');
    expect(axios.get).toHaveBeenCalledWith('http://csv.test', { responseType: 'text', timeout: 10000 });
    expect(addrWeights.get('0xaaa')).toBeCloseTo(2);
  });
});
