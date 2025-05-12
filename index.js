require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const axios   = require('axios');
const pLimit  = require('p-limit');

const app         = express();
const PORT        = process.env.PORT || 3000;
const HL_API_BASE = process.env.HL_API_BASE;

// throttle concurrent requests to avoid rate limits
const limit = pLimit(5);  // max 5 concurrent API calls

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

/**
 * POST /api/check-trades
 * Body: { addresses: string[], hours: number }
 */
app.post('/api/check-trades', async (req, res) => {
  const { addresses, hours } = req.body;

  if (!Array.isArray(addresses) || addresses.length === 0) {
    return res.status(400).json({ error: 'addresses must be a non-empty array' });
  }
  const hrs = Math.min(Math.max(Number(hours) || 1, 1), 168);
  const now = Date.now();
  const startTime = now - hrs * 3600 * 1000;

  const jobs = addresses.map(addr => limit(async () => {
    if (typeof addr !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      return { address: addr, error: 'invalid ethereum address' };
    }
    try {
      const r = await axios.post(`${HL_API_BASE}/info`, {
        type: 'userFillsByTime', user: addr,
        startTime, endTime: now, aggregateByTime: false
      });
      return { address: addr, trades: Array.isArray(r.data) ? r.data : [] };
    } catch (err) {
      return { address: addr, error: err.response?.data || err.message };
    }
  }));

  try {
    const results = await Promise.all(jobs);
    res.json(results);
  } catch (e) {
    console.error('Unexpected error in /api/check-trades', e);
    res.status(500).json({ error: 'internal error' });
  }
});

// GET /api/portfolio/:address
app.get('/api/portfolio/:address', async (req, res) => {
  const { address } = req.params;

  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return res.status(400).json({ error: 'Invalid Ethereum address format' });
  }

  try {
    const { data } = await axios.post(`${HL_API_BASE}/info`, {
      type: 'portfolio',
      user: address,
    });

    res.json(data);
  } catch (error) {
    console.error(`❌ /api/portfolio error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});


app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});