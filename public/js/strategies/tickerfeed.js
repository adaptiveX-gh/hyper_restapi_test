import { $, text } from '../core/dom.js';

$('feed-run').addEventListener('click', async ()=>{
  const out = $('feed-output'); text('feed-output','⏳ Fetching …');
  const coin       = $('feed-coin').value.trim();
  const liqMinutes = +$('feed-liqMin').value;
  const tradeLimit = +$('feed-tradeLimit').value;

  const res = await fetch('/api/tickerFeed',{
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ coin, params:{ liqMinutes, tradeLimit } })
  });
  if(!res.ok){ text('feed-output',`❌ ${res.status}: ${await res.text()}`); return; }
  const data = await res.json();
  text('feed-output', JSON.stringify(data,null,2));
});
$('feed-copy-output').addEventListener('click', ()=> navigator.clipboard.writeText($('feed-output').textContent));
