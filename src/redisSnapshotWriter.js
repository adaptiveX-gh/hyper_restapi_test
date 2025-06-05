export function startSnapshotWriter(client, { coin = 'BTC', getSnapshot } = {}) {
  if (!client || typeof client.set !== 'function') {
    throw new Error('redis client with .set() required');
  }
  if (typeof getSnapshot !== 'function') {
    throw new Error('getSnapshot function required');
  }
  const key = `snap:${coin}`;
  const write = async () => {
    try {
      const snap = getSnapshot();
      if (!snap) return;
      const payload = { ts: Date.now(), ...snap };
      const json = JSON.stringify(payload);
      if (Buffer.byteLength(json) > 5 * 1024) {
        console.warn('[snapshot] payload too large');
        return;
      }
      await client.set(key, json, { EX: 5 });
    } catch (err) {
      console.warn('[snapshot] write failed', err);
    }
  };
  const id = setInterval(write, 3000);
  return () => clearInterval(id);
}
