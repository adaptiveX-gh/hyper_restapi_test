import express from 'express';

export function mountGsRelay(app) {
  const upstream = process.env.GS_LOG_URL;  // secret, NOT exposed to client
  if (!upstream) {
    console.warn('[GS-Relay] GS_LOG_URL missing - journal relay disabled');
    return;
  }

  app.post('/gs-journal', express.json({ limit: '10kb' }), async (req, res) => {
    try {
      const gRes = await fetch(upstream, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify(req.body)
      });
      if (!gRes.ok) throw new Error(`${gRes.status} ${gRes.statusText}`);
      res.sendStatus(200);
    } catch (err) {
      console.warn('[GS-Relay] upstream error:', err.message);
      res.status(502).json({ error: 'Upstream failed' });
    }
  });
}
