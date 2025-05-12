require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const axios   = require('axios');
const path    = require('path');

const app  = express();
const PORT = Number(process.env.PORT) || 3000;
const HL   = process.env.HL_API_BASE;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Wraps an HL /info call and defaults on 422/429
async function safeFetch(type, user, extra = {}) {
  try {
    const { data } = await axios.post(`${HL}/info`, { type, user, ...extra });
    return data;
  } catch (e) {
    console.warn(`> [${type}] ${user} →`, e.response?.status || e.message);
    if (type === 'userFillsByTime') return [];
    if (type === 'userPositions')   return [];
    if (type === 'userMargin')      return { maintenanceMargin: 0 };
    return null;
  }
}

// POST /api/check-trades  (throttled, sequential)
app.post('/api/check-trades', async (req, res) => {
    const { addresses, hours } = req.body;
    if (
      !Array.isArray(addresses) ||
      addresses.some(a => !/^0x[0-9a-fA-F]{40}$/.test(a))
    ) {
      return res.status(400).json({ error: 'Invalid addresses array.' });
    }
    const hrs = Math.min(Math.max(Number(hours) || 1, 1), 168);
    const now = Date.now();
  
    const results = [];
    for (const addr of addresses) {
      const trades = await safeFetch('userFillsByTime', addr, {
        startTime: now - hrs * 3600_000,
        endTime: now,
        aggregateByTime: false
      });
      results.push({ address: addr, trades });
      // tiny pause to avoid hitting rate limits
      await new Promise(r => setTimeout(r, 100));
    }
  
    res.json(results);
  });
  

// POST /api/trader-alerts
app.post('/api/trader-alerts', async (req, res) => {
  const { addresses, hours } = req.body;
  if (
    !Array.isArray(addresses) ||
    addresses.some(a => !/^0x[0-9a-fA-F]{40}$/.test(a))
  ) {
    return res.status(400).json({ error: 'Invalid addresses array.' });
  }
  const hrs = Math.min(Math.max(Number(hours) || 1, 1), 168);
  const now = Date.now();

  const results = [];
  for (const addr of addresses) {
    // 1) fills
    const fills = await safeFetch('userFillsByTime', addr, {
      startTime: now - hrs * 3600_000,
      endTime: now,
      aggregateByTime: false
    });
    if (!fills.length) {
      results.push({ address: addr, alert: null });
      await new Promise(r => setTimeout(r, 100));
      continue;
    }

    // 2) positions & margin
    const positions = await safeFetch('userPositions', addr);
    const margin    = await safeFetch('userMargin',    addr);

    // craft alert
    const last     = fills[fills.length - 1];
    const coin     = last.coin;
    const dir      = last.dir.includes('Short') ? 'short' : 'long';
    const action   = last.dir.startsWith('Close') ? 'reduced' : 'increased';
    const fillAmt  = parseFloat(last.sz) * parseFloat(last.px);
    const fillPx   = parseFloat(last.px);
    const posObj   = positions.find(p => p.coin === coin) || { size: 0, entryPrice: 0 };
    const size     = parseFloat(posObj.size);
    const avgPx    = parseFloat(posObj.entryPrice);
    const mm       = parseFloat(margin.maintenanceMargin) || 0;
    let liq        = null;
    if      (size >  0) liq = avgPx * (1 - mm);
    else if (size <  0) liq = avgPx * (1 + mm);

    let alert = `A top trader just ${action} their ${dir} $${coin} position by $${fillAmt.toFixed(2)} at $${fillPx}.\n`;
    alert += `This user's current position is ${dir} $${(Math.abs(size)*avgPx).toFixed(2)} of $${coin} at an average price of $${avgPx}.\n`;
    if (liq !== null) {
      alert += `They would be liquidated if $${coin} ever reaches $${liq.toFixed(2)}.`;
    }

    results.push({ address: addr, alert });
    await new Promise(r => setTimeout(r, 100)); // simple throttle
  }

  res.json(results);
});

// SPA fallback
app.get('*', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public/index.html'))
);

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
