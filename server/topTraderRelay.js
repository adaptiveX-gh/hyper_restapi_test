export const GOOGLE_URL =
  'https://script.google.com/macros/s/AKfycbVoUCKNWedWUStRHQexzDDfW5mMRRzEz1ygZ0oWR8IFT2Ly7hsrVdVKDLJyyS6tD-a4g/exec';

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
