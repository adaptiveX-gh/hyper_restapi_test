export function calcBands(candles){
  if(!Array.isArray(candles) || candles.length===0) return null;
  const last60 = candles.slice(-60);
  if(last60.length<60) return null;
  const sumPxVol = last60.reduce((s,c)=>s + Number(c.c)*Number(c.v),0);
  const sumVol    = last60.reduce((s,c)=>s + Number(c.v),0);
  const vwap = sumVol ? sumPxVol / sumVol : 0;
  const trArr = last60.map((c,i)=>{
    const prev = i ? Number(last60[i-1].c) : Number(c.o);
    const high = Number(c.h); const low = Number(c.l);
    return Math.max(high-low, Math.abs(high-prev), Math.abs(low-prev));
  });
  const atr = trArr.reduce((a,b)=>a+b,0)/trArr.length;
  return { vwap, atr, up1:vwap+atr, up2:vwap+2*atr, dn1:vwap-atr, dn2:vwap-2*atr };
}

import { WebSocket } from 'ws';

export function startMacroBandsService(broadcast, coin = 'BTC') {
  const ws = new WebSocket('wss://api.hyperliquid.xyz/ws');
  const buf = [];
  let lastMid = null;

  ws.on('open', () => {
    ws.send(
      JSON.stringify({
        method: 'subscribe',
        subscription: { type: 'candle', coin, interval: '1m' }
      })
    );
  });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.channel !== 'candle') return;
    const c = Array.isArray(msg.data) ? msg.data.at(-1) : msg.data;
    if (!c) return;
    buf.push({ o: +c.o, h: +c.h, l: +c.l, c: +c.c, v: +c.v });
    if (buf.length > 60) buf.shift();
    lastMid = +c.c;
  });

  const timer = setInterval(() => {
    const b = calcBands(buf);
    if (!b) return;
    broadcast({
      type: 'macroBands',
      payload: {
        ts: Date.now(),
        midPrice: lastMid,
        vwap: b.vwap,
        atr: b.atr,
        up1: b.up1,
        up2: b.up2,
        dn1: b.dn1,
        dn2: b.dn2
      }
    });
  }, 60_000);

  return { stop: () => { clearInterval(timer); ws.close(); } };
}
