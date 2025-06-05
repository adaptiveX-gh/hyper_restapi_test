import { calcBands } from '../src/macroBands.js';

describe('calcBands', () => {
  test('computes VWAP and ATR correctly', () => {
    const candles = Array.from({length:60}).map(()=>({o:100,h:101,l:99,c:100,v:100}));
    const res = calcBands(candles);
    expect(res.vwap).toBeCloseTo(100,2);
    expect(res.atr).toBeCloseTo(2,2);
    expect(res.up1).toBeCloseTo(102,2);
    expect(res.dn2).toBeCloseTo(96,2);
  });
});
