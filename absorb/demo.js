import axios from 'axios';
import WebSocket from 'ws';
import { TapeFlowAnalyzer } from './tapeFlow.js';

// Demo using live data from Hyperliquid
const COIN = process.env.COIN || 'BTC';
const DEPTH = 20;               // depth snapshot size
const analyzer = new TapeFlowAnalyzer(20);

function toPair({ px, sz }) {
  return [+px, +sz];
}

async function fetchBook() {
  const body = { type: 'l2Book', coin: COIN, depth: DEPTH };
  const { data } = await axios.post('https://api.hyperliquid.xyz/info', body);
  return {
    bids: data.levels[0].map(toPair),
    asks: data.levels[1].map(toPair)
  };
}

const ws = new WebSocket('wss://api.hyperliquid.xyz/ws');
ws.on('open', () => {
  ws.send(JSON.stringify({
    method: 'subscribe',
    subscription: { type: 'trades', coin: COIN }
  }));
});

ws.on('message', async buf => {
  let msg;
  try { msg = JSON.parse(buf); } catch { return; }
  if (msg.channel !== 'trades') return;

  for (const trade of msg.data || []) {
    try {
      const preBook = await fetchBook();
      const postBookPromise = fetchBook();
      const event = analyzer.process(trade, preBook, await postBookPromise);
      console.log('Bias', analyzer.getBias().toFixed(2));
    } catch (err) {
      console.error('Error processing trade', err.message);
    }
  }
});

ws.on('close', () => process.exit(0));
