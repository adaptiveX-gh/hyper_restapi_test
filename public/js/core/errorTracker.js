const banner = () => document.getElementById('ticker-inner');

let lastLog = 0;
let consecutive = 0;
let backoff = 0;
let bannerShown = false;

export function recordSuccess(){
  consecutive = 0;
  backoff = 0;
  if(bannerShown){
    const el = banner();
    if(el) el.textContent = 'Connection restored';
    bannerShown = false;
  }
}

export function recordError(status, url){
  if(status !== 502) return;
  const now = Date.now();
  consecutive++;
  if(now - lastLog > 5000){
    console.warn(`[HTTP 502] ${url}`);
    lastLog = now;
  }
  backoff = Math.min(backoff ? backoff * 2 : 1000, 60000);
  if(consecutive >= 3 && !bannerShown){
    const el = banner();
    if(el) el.textContent = 'Realtime data unavailable (HTTP 502). Reconnecting...';
    bannerShown = true;
  }
}

export function getBackoff(){ return backoff; }
