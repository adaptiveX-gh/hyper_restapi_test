(() => {
  const KEY = 'qr-last-snap';
  try {
    const cached = localStorage.getItem(KEY);
    if (cached) {
      window.__WARM_SNAP = JSON.parse(cached);
    }
  } catch {}

  async function fetchSnap() {
    try {
      const res = await fetch('/api/dashboardBootstrap');
      if (!res.ok || res.status === 204) return;
      const snap = await res.json();
      localStorage.setItem(KEY, JSON.stringify(snap));
      window.__WARM_SNAP = snap;
      if (window.paint) window.paint(snap);
    } catch (err) {
      console.warn('[bootstrap]', err);
    } finally {
      if (window.NProgress) window.NProgress.done();
    }
  }

  document.addEventListener('DOMContentLoaded', fetchSnap);
})();
