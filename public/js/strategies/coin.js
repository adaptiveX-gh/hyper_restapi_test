/*  js/strategies/coin.js
    ─────────────────────────────────────────────────────────────
    Coin‑Activity pane – start / stop stream + progress & timer
*/

import { $, append, text, readLines } from '../core/dom.js';
import { loadSheetAddresses }          from '../core/api.js';
import { mountProgressBar, setProgress, resetProgress } from '../core/progress.js';

/* ─────────────────────────────  DOM refs  ───────────────────────────── */
const addrBox  = $('coin-addrs');
const outBox   = $('coin-output');
const statsBox = $('coin-stats');

const btnStart = $('coin-run');          // “Fetch Activity” button
const btnStop  = $('coin-stop');         // new Stop button (must be in HTML)

/* ids for progress + timer */
const BAR_ID   = 'coin-progress';
const TIMER_ID = 'coin-timer';
const ANCHOR   = 'coin-progress-anchor';

/* ─────────────────────────────  Event wiring  ───────────────────────── */
$('coin-load')?.addEventListener('click', loadAddresses);
btnStart      ?.addEventListener('click', startCoinStream);
btnStop       ?.addEventListener('click', stopCoinStream);

$('coin-clear-stats') ?.addEventListener('click', () => text(statsBox,''));
$('coin-clear-results')?.addEventListener('click', () => text(outBox,''));
$('coin-copy-stats')  ?.addEventListener('click', () => navigator.clipboard.writeText(statsBox.textContent));
$('coin-copy-output') ?.addEventListener('click', () => navigator.clipboard.writeText(outBox.textContent));

/* ─────────────────────────────  helpers  ───────────────────────────── */
const numOrU = id => { const v = $(id)?.value?.trim() ?? ''; return v===''?undefined:Number(v);} ;

/* timer helpers */
let timerHandle=null;
function startTimer(){
  let el=$(TIMER_ID);
  if(!el){el=document.createElement('span');el.id=TIMER_ID;el.style.cssText='margin-left:8px;font-family:monospace;font-size:.85rem;opacity:.7';$(BAR_ID).after(el);} 
  const bar=$(BAR_ID);(bar?.parentElement??bar).after(el);
  const t0=Date.now();
  const tick=()=>{const s=((Date.now()-t0)/1000)|0;el.textContent=`⏱ ${String((s/60)|0).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;};
  tick();timerHandle=setInterval(tick,1000);
}
function stopTimer(){if(timerHandle)clearInterval(timerHandle);timerHandle=null;$(TIMER_ID)?.remove();}

/* state */
let abortCtrl=null;
let reader=null;

/* ============================================================ */
/*  Load addresses from sheet                                   */
/* ============================================================ */
async function loadAddresses(){
  text(statsBox,'');
  const filters={ pnlMin:numOrU('coin-pnlMin'), winRateMin:numOrU('coin-winRateMin'), durationMin:numOrU('coin-durationMin') };
  try{
    const addrs=await loadSheetAddresses(filters);
    addrBox.value=addrs.join('\n');
    text(statsBox,`✅ ${addrs.length} addresses loaded`);
  }catch(err){text(statsBox,`❌ ${err.message}`);console.error('[coin] loadSheetAddresses failed',err);}
}

/* ============================================================ */
/*  Start stream                                                */
/* ============================================================ */
async function startCoinStream(){
  if(abortCtrl) return; // already running

  btnStart?.setAttribute('disabled','');
  btnStop ?.removeAttribute('disabled');

  text(outBox,'');text(statsBox,'');
  mountProgressBar(ANCHOR,BAR_ID,'after');
  resetProgress(BAR_ID);
  startTimer();

  const addresses=readLines(addrBox);
  const total=addresses.length||1;
  const seen=new Set();

  const minutes=+$('coin-minutes')?.value||15;
  const coinTicker=$('coin-ticker')?.value.trim()||'BTC-PERP';
  const minNotional=+$('coin-minNotional')?.value||0;

  abortCtrl=new AbortController();
  const {signal}=abortCtrl;

  let res;
  try{
    res=await fetch('/api/coinActivityStream',{
      method:'POST',signal,
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({addresses,minutes,params:{coin:coinTicker,minNotional}})
    });
  }catch(err){if(err.name!=='AbortError')text(statsBox,`❌ ${err.message}`);cleanup();return;}

  if(!res.body){text(statsBox,'❌ no response body');cleanup();return;}

  reader=res.body.getReader();
  const dec=new TextDecoder();
  let buf='';
  try{
    while(true){
      const {value,done}=await reader.read();
      if(done)break;
      buf+=dec.decode(value,{stream:true});
      let idx;
      while((idx=buf.indexOf('\n'))!==-1){
        const line=buf.slice(0,idx).trim();
        buf=buf.slice(idx+1);
        if(!line)continue;
        const j=JSON.parse(line);
        if(j.type==='log'){
          append(statsBox,line+'\n');
          if(j.trader&& !seen.has(j.trader)){
            seen.add(j.trader);
            setProgress(BAR_ID,seen.size/total);
          }
        }
        if(j.type==='result') append(outBox,line+'\n');
        if(j.type==='summary'){
          if(!outBox.textContent.trim()) text(outBox,'no-activity\n');
          setProgress(BAR_ID,1);
          cleanup();
        }
      }
    }
  }catch(err){ if(err.name!=='AbortError')console.error('[coin] stream error',err); cleanup(); }
}

/* ============================================================ */
/*  Stop stream                                                 */
/* ============================================================ */
function stopCoinStream(){
  if(!abortCtrl) return;
  abortCtrl.abort();
  reader?.cancel().catch(()=>{});
  cleanup();
}

/* cleanup */
function cleanup(){
  abortCtrl=null;reader=null;
  stopTimer();setProgress(BAR_ID,0);
  btnStart?.removeAttribute('disabled');
  btnStop ?.setAttribute('disabled','');
}
