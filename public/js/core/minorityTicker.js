export const STRONG_BOUNCE_DEDUP_MS = 180000;
export const LIQUIDITY_VACUUM_DEDUP_MS = 180000;
let lastBounce = 0;
let lastVacuum = 0;

export function showTicker(msg, side = 'bull') {
  const el = document.getElementById('ticker-inner');
  if (el) el.textContent = msg;
  const box = document.getElementById('ticker-box');
  if (box) box.style.background = side === 'bull' ? '#193' : '#611';
  setTimeout(() => {
    if (el && el.textContent === msg) el.textContent = '';
  }, 120000);
}

export function computeBounce({ earlyWarn = 0, confirm = 0, LaR = 0, momentum = 0, MPD = 0 } = {}) {
  return (
    earlyWarn > 0.05 &&
    confirm > 0.25 &&
    LaR >= 0.35 &&
    momentum > 0.10 &&
    MPD > 0.5
  );
}

import { push } from './eventNormalize.js';

export function handleStrongBounce(radar, ctx = {}, now = Date.now()) {
  if (
    computeBounce(ctx) &&
    now - lastBounce > STRONG_BOUNCE_DEDUP_MS
  ) {
    showTicker('⚡ Strong Bounce Incoming', 'bull');
    push({ kind:'strong_bounce_incoming', strength:1, ts: now, side:'neutral' });
    lastBounce = now;
  }
}

export function computeFlush({
  LaR = 1,
  resilience = 0,
  confirm = 0,
  momentum = 0,
  MPD = 0,
  sweepHit = false
} = {}) {
  return (
    LaR < 0.25 &&
    resilience < 0 &&
    confirm < -0.20 &&
    momentum <= -0.10 &&
    (MPD < -0.5 || sweepHit)
  );
}

export function handleLiquidityVacuum(radar, ctx = {}, now = Date.now()) {
  if (computeFlush(ctx) && now - lastVacuum > LIQUIDITY_VACUUM_DEDUP_MS) {
    showTicker('🩸 Liquidity Vacuum — Expect Flush', 'bear');
    push({ kind:'liquidity_vacuum_flush', strength:1, ts: now, side:'neutral' });
    lastVacuum = now;
  }
}

export function resetStrongBounce() {
  lastBounce = 0;
}

export function resetLiquidityVacuum() {
  lastVacuum = 0;
}
