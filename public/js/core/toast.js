export function showWinToast(data){
  let container = document.getElementById('toast-container');
  if(!container){
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  const gradeCls = data.grade ? data.grade.toLowerCase() : '';
  toast.className = `toast ${data.side} ${gradeCls}`;

  const header = document.createElement('div');
  header.className = 'toast-header';
  if (data.grade === 'Strong') {
    header.textContent = `\u2705 Strong Signal — ${data.side === 'bull' ? 'Bull Win (LONG)' : 'Bear Win (SHORT)'}`;
  } else if (data.grade === 'Caution') {
    header.textContent = `\u26A0\uFE0F Caution: Weak Context — ${data.side === 'bull' ? 'Bull Win (LONG)' : 'Bear Win (SHORT)'}`;
  } else if (data.grade === 'Vetoed') {
    header.textContent = `\u274C Blocked: Context vetoed the trade — ${data.side === 'bull' ? 'Bull Win (LONG)' : 'Bear Win (SHORT)'}`;
  } else {
    header.textContent = data.side === 'bull' ? 'Bull Win!' : 'Bear Win!';
  }

  const timeEl = document.createElement('span');
  timeEl.className = 'toast-time';
  timeEl.textContent = new Date().toISOString().slice(11,19) + ' UTC';
  header.appendChild(timeEl);

  const close = document.createElement('button');
  close.className = 'toast-close';
  close.textContent = '×';
  close.addEventListener('click', () => {
    container.removeChild(toast);
  });
  header.appendChild(close);

  toast.appendChild(header);

  const msg = document.createElement('div');
  msg.className = 'toast-msg';
  if (data.grade === 'Vetoed') {
    msg.textContent = 'No trade logged \u2014 probable fake-out.';
  } else {
    msg.textContent = 'Trade logged to journal.';
  }
  toast.appendChild(msg);

  const details = document.createElement('div');
  details.className = 'toast-details';
  const pieces = [];
  if(data.dir) pieces.push(data.dir);
  if(data.price!=null) pieces.push('@ '+data.price);
  if(data.obi!=null) pieces.push('OBI '+Number(data.obi).toFixed(2));
  if(data.earlyWarn!=null) pieces.push('Early '+data.earlyWarn.toFixed(2));
  if(data.confirm!=null) pieces.push('Confirm '+data.confirm.toFixed(2));
  if(data.resilience!=null) pieces.push('Res '+data.resilience.toFixed(2));
  if(data.lar!=null) pieces.push('LaR '+data.lar);
  if(data.oi!=null) pieces.push('OI '+data.oi);
  details.textContent = pieces.join(' ');
  toast.appendChild(details);

  if (Array.isArray(data.warnings) && data.warnings.length) {
    const warn = document.createElement('div');
    warn.className = 'toast-details';
    warn.textContent = 'Reason: ' + data.warnings.join(', ');
    toast.appendChild(warn);
  }

  container.appendChild(toast);

  setTimeout(() => {
    if(container.contains(toast)) container.removeChild(toast);
  }, 30000);
}
