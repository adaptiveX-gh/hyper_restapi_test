export const GOOGLE_URL =
  process.env.GS_TOP_TRADER_WEIGHTS_URL ||
  'https://script.google.com/macros/s/AKfycbwiSwVbWyRNH5UZ6KkXy-qbV1mAaFWrwiISRDIBEtlCYvXec-UT2PdQh6romltUIfM/exec';

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
