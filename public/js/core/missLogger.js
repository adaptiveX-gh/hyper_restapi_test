// missLogger.js - queue miss events and send to Google Sheet

const QUEUE_KEY = 'missLogQueue';
const FLUSH_MS  = 10000; // 10 s

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
  console.log('[TEST TRADE EVENT]', row, 'URL:', window.GS_LOG_URL);
  const q = load();
  q.push(row);
  save(q);
  flushQueue();
}

export async function flushQueue(){
  const url = window.GS_LOG_URL;
  if(!url){
    console.warn('[missLogger] GS_LOG_URL not set');
    return;
  }
  let q = load();
  while(q.length){
    const item = q[0];
    try{
      const resp = await fetch(url, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(item)
      });
      const text = await resp.text();
      console.log('[SHEET RESP]', resp.status, text);
      q.shift();
    }catch(e){
      console.warn('[GS LOG ERROR]', e);
      break;
    }
  }
  save(q);
}

if (typeof window !== 'undefined'){
  setInterval(flushQueue, FLUSH_MS);
}
