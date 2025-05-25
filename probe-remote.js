import fetch from "node-fetch";   // if on Node<18, npm i node-fetch@2
const mkt = "BTC-PERP";

async function tryPath(desc, url, opts) {
  try {
    const r = await fetch(url, opts);
    console.log(desc, r.status);
    if (r.ok) console.log("  →", (await r.text()).slice(0,120), "..."); // preview
  } catch(e) {
    console.log(desc, "ERR", e.message);
  }
}

await tryPath("GET  /trades",
  `https://api.hyperliquid.xyz/trades?market=${encodeURIComponent(mkt)}&limit=3`);

await tryPath("POST /info (candles)",
  "https://api.hyperliquid.xyz/info",
  { method:"POST", headers:{'content-type':'application/json'},
    body: JSON.stringify({type:"candles",market:mkt,interval:"30s",limit:3}) });

await tryPath("POST /info (trades)",
  "https://api.hyperliquid.xyz/info",
  { method:"POST", headers:{'content-type':'application/json'},
    body: JSON.stringify({type:"trades",market:mkt,limit:3}) });

await tryPath("GraphQL systemStatus",
  "https://api.hyperliquid.xyz/graphql",
  { method:"POST", headers:{'content-type':'application/json'},
    body: '{"query":"{systemStatus}"}' });
