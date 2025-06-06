import { logMiss } from './missLogger.js';
import bus from './eventBus.js';

let warmupMs = 5000;
let startTime = Date.now();

let prevBull = 0;
let prevBear = 0;
let bullArmed = true;
let bearArmed = true;
let lastTrap = 0;

export function setWarmupMs(ms) {
  warmupMs = ms;
}

export function resetTrigger() {
  prevBull = 0;
  prevBear = 0;
  bullArmed = true;
  bearArmed = true;
  lastTrap = 0;
  startTime = Date.now();
}

export function onGaugeUpdate({ bullPct = 0, bearPct = 0, midPrice = null, trapValue = null } = {}) {
  if (typeof trapValue === 'number') lastTrap = trapValue;
  if (Date.now() - startTime < warmupMs) return;
  if (bullArmed && bullPct >= 45 && prevBull < 45) {
    fire('LONG', 'bull', bullPct, midPrice);
    bullArmed = false;
  } else if (bullPct < 45) {
    bullArmed = true;
  }

  if (bearArmed && bearPct >= 45 && prevBear < 45) {
    fire('SHORT', 'bear', bearPct, midPrice);
    bearArmed = false;
  } else if (bearPct < 45) {
    bearArmed = true;
  }

  prevBull = bullPct;
  prevBear = bearPct;
}

function fire(dir, side, pct, midPrice) {
  const ctx = window.contextMetrics || {};
  const trap = typeof lastTrap === 'number' ? lastTrap : 0;
  const vetoLong = dir === 'LONG' && trap > 0.50;
  const vetoShort = dir === 'SHORT' && trap < -0.50;
  const entry = {
    type: 'Top Trader',
    side,
    dir,
    price: midPrice ?? null,
    obi: window.__lastObiRatio ?? null,
    lar: window.__LaR ?? null,
    oi: window.__prevOi ?? null,
    confirm: ctx.confirm,
    earlyWarn: ctx.earlyWarn,
    resilience: ctx.resilience,
    trap,
    grade: 'Edge',
    warnings: [`${pct.toFixed(1)} % gauge`]
  };
  if (vetoLong || vetoShort) {
    entry.grade = 'Vetoed';
    entry.warnings.push('Trap');
  }
  logMiss(entry).then(() => bus.emit('trade:acked', entry));
  bus.emit('trade:fire', entry);
}
