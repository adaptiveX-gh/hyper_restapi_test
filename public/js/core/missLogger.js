// missLogger.js - queue miss events and send to Google Sheet

const QUEUE_KEY = 'missLogQueue';
const FLUSH_MS  = 10000; // 10 s
let failStreak = 0;
let isFlushing = false;

/** Persist queue to localStorage */
function save(q){
  try{ localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }
  catch{}
}

/** Load queue from localStorage */
function load(){
  try{ return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); }
  catch{ return []; }
}

export async function logMiss(entry){
  const row = { timestamp:new Date().toISOString(), ...entry };
  console.log('[TEST TRADE EVENT]', row);
  if (localStorage.getItem('missLogQueueV') !== 'v2') {
    localStorage.removeItem('missLogQueue');
    localStorage.setItem('missLogQueueV', 'v2');
  }
  const q = load();
  q.push(row);
  save(q);
  flushQueue();
}

export async function flushQueue(){
  if (isFlushing) return;
  isFlushing = true;
  const url = '/gs-journal';
  let q = load();
  try {
    while (q.length) {
      const item = q[0];
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item)
        });
        const text = await resp.text();
        console.log('[SHEET RESP]', resp.status, text);
        if (!resp.ok || text.includes('Upstream failed')) throw new Error(text);
        q.shift();
        failStreak = 0;
      } catch (e) {
        console.warn('[GS LOG ERROR]', e);
        failStreak++;
        if (failStreak >= 3 && typeof window !== 'undefined') {
          console.warn('Could not log trades – retrying…');
        }
        break;
      }
    }
    save(q);
  } finally {
    isFlushing = false;
  }
}

if (typeof window !== 'undefined'){
  setInterval(flushQueue, FLUSH_MS);
}
