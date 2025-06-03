import axios from 'axios';
import { WebSocket } from 'ws';
import { PassThrough } from 'stream';

export const SHEET_CSV =
  'https://docs.google.com/spreadsheets/d/1EI4_ZL_HPJh66Q5aXlbhAKJhGSQjwc0e9D968mc1yR0/export?format=csv&gid=486840509';

export const topTrades = [];
export let addrWeights = new Map();
export const topFlowBus = new PassThrough();
const MAX_ROWS = 1000;

export function parseWeightsCsv(csv) {
  const rows = csv.trim().split(/\r?\n/).slice(1);
  return new Map(
    rows.map(r => {
      const [addr, weight] = r.split(',');
      return [addr.trim().toLowerCase(), Number(weight) || 0];
    })
  );
}

export async function loadWeights(url = SHEET_CSV) {
  const { data } = await axios.get(url, { responseType: 'text', timeout: 10000 });
  addrWeights = parseWeightsCsv(data);
  return addrWeights;
}

export function weightsRoute(app, map = addrWeights) {
  app.get('/weights.json', (_, res) => {
    res.json(Object.fromEntries(map));
  });
}

function throttle(fn, ms) {
  let last = 0, t;
  return (...args) => {
    const now = Date.now();
    const diff = now - last;
    if (diff >= ms) {
      last = now;
      fn(...args);
    } else {
      clearTimeout(t);
      t = setTimeout(() => { last = Date.now(); fn(...args); }, ms - diff);
    }
  };
}

export function extractRowsFromTrade(t) {
  const px = +t.px;
  const sz = +t.sz;
  const notional = px * sz;
  const ts = new Date(t.time);
  const [buyer, seller] = t.users.map(a => a.toLowerCase());
  const rows = [];
  if (addrWeights.has(buyer)) rows.push(makeRow(buyer, 'LONG', +1));
  if (addrWeights.has(seller)) rows.push(makeRow(seller, 'SHORT', -1));
  return rows;

  function makeRow(addr, side, bias) {
    return {
      trader: addr,
      weight: addrWeights.get(addr),
      side,
      notional,
      price: px,
      time: ts.toLocaleTimeString('en-US', { hour12: false }),
      bias
    };
  }
}

const push = throttle(row =>
  topFlowBus.write(JSON.stringify(row) + '\n\n'), 250);

function recordRow(row) {
  topTrades.unshift(row);
  if (topTrades.length > MAX_ROWS) topTrades.pop();
  push(row);
  const shortAddr = row.trader.slice(0,3) + '…' + row.trader.slice(-2);
  console.log(`[TopFlow] ${row.time} ${shortAddr} ${row.side} $${row.notional.toLocaleString()} weight ${row.weight} bias ${row.bias > 0 ? '+1' : '-1'}`);
}

let ws;
function startWs() {
  ws = new WebSocket('wss://api.hyperliquid.xyz/ws');
  ws.on('open', () => {
    ws.send(JSON.stringify({
      method: 'subscribe',
      subscription: { type: 'trades', coin: 'BTC' }
    }));
  });
  ws.on('message', buf => {
    let msg;
    try { msg = JSON.parse(buf); } catch { return; }
    if (msg.channel !== 'trades') return;
    for (const t of msg.data || []) {
      const rows = extractRowsFromTrade(t);
      rows.forEach(recordRow);
    }
  });
  ws.on('close', () => setTimeout(startWs, 2000));
  ws.on('error', () => ws.close());
}

export async function startTopTraderService() {
  await loadWeights();
  startWs();
}

export function getTopTrades() {
  return topTrades;
}

export function injectTopTrade(trade) {
  const rows = extractRowsFromTrade(trade);
  rows.forEach(recordRow);
  return rows;
}
