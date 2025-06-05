import bus from './eventBus.js';

function clamp(x){
  return Math.max(0, Math.min(x ?? 0, 1));
}

/**
 * Normalised QuantRadar event
 * @typedef {Object} QREvent
 * @property {number} ts
 * @property {string} sym
 * @property {'buy'|'sell'|'neutral'} side
 * @property {string} kind
 * @property {number} strength
 * @property {Object} meta
 */

/**
 * @param {Partial<QREvent>} ev
 */
export function push(ev){
  bus.emit('qr:event', {
    ts  : ev.ts  ?? Date.now(),
    sym : ev.sym ?? 'BTC-PERP',
    side: ev.side ?? 'neutral',
    kind: ev.kind,
    strength: clamp(ev.strength),
    meta: ev.meta ?? {}
  });
}
