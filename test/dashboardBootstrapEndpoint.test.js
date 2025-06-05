import { createServer } from 'http';
import { app } from '../server.js';

class MockRedis {
  constructor() { this.store = new Map(); }
  async get(key) { return this.store.get(key); }
}

describe('GET /api/dashboardBootstrap', () => {
  test('returns 200 with cached snapshot when key exists', async () => {
    const client = new MockRedis();
    const snap = { bullPct: 60, bearPct: 20 };
    client.store.set('snap:BTC', JSON.stringify(snap));
    app.locals.redis = client;

    const server = createServer(app);
    await new Promise(res => server.listen(0, res));
    const { port } = server.address();

    const res = await fetch(`http://localhost:${port}/api/dashboardBootstrap?coin=BTC`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body).toEqual(snap);

    server.close();
  });
});

