export const STRONG_BOUNCE_DEDUP_MS = 180000;
let lastBounce = 0;

export function showTicker(msg, side = 'bull') {
  const el = document.getElementById('ticker-inner');
  if (el) el.textContent = msg;
  const box = document.getElementById('ticker-box');
  if (box) box.style.background = side === 'bull' ? '#193' : '#611';
  setTimeout(() => {
    if (el && el.textContent === msg) el.textContent = '';
  }, 120000);
}

export function handleStrongBounce(radar, ctx = {}, now = Date.now()) {
  const { earlyWarn = 0, confirm = 0, LaR = 0, momentum = 0 } = ctx;
  if (
    earlyWarn > 0.05 &&
    confirm > 0.25 &&
    LaR >= 0.35 &&
    momentum > 0.10 &&
    now - lastBounce > STRONG_BOUNCE_DEDUP_MS
  ) {
    showTicker('⚡ Strong Bounce Incoming', 'bull');
    if (radar && typeof radar.addBubble === 'function') {
      radar.addBubble('strong_bounce_incoming', { ts: now, strength: 1 });
    }
    lastBounce = now;
  }
}

export function resetStrongBounce() {
  lastBounce = 0;
}
