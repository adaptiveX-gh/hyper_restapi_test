export const GOOGLE_URL =
  process.env.GS_TOP_TRADER_WEIGHTS_URL ||
  'https://script.google.com/macros/s/AKfycbwYUevD0gVcV6kJZdFHySL8AbD3bI6DZNisX9TKq-HrJbqhl4nZYcl5XjA30xavksG7/exec';

export function relayRoute(app) {
  app.get('/weights.json', async (req, res) => {
    try {
      const gRes = await fetch(GOOGLE_URL, { cache: 'no-store' });
      if (!gRes.ok) throw new Error(gRes.statusText);
      const body = await gRes.text();
      res.setHeader('Content-Type', 'application/json');
      res.send(body);
    } catch (err) {
      console.error('[weights] relay error', err);
      res.status(502).json({ error: 'Upstream fetch failed' });
    }
  });
}
