export function showWinToast(data){
  let container = document.getElementById('toast-container');
  if(!container){
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${data.side}`;

  const header = document.createElement('div');
  header.className = 'toast-header';
  header.textContent = data.side === 'bull' ? 'Bull Win!' : 'Bear Win!';

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
  msg.textContent = 'Trade logged to journal.';
  toast.appendChild(msg);

  const details = document.createElement('div');
  details.className = 'toast-details';
  const pieces = [];
  if(data.dir) pieces.push(data.dir);
  if(data.price!=null) pieces.push('@ '+data.price);
  if(data.obi!=null) pieces.push('OBI '+Number(data.obi).toFixed(2));
  if(data.lar!=null) pieces.push('LaR '+data.lar);
  if(data.oi!=null) pieces.push('OI '+data.oi);
  details.textContent = pieces.join(' ');
  toast.appendChild(details);

  container.appendChild(toast);

  setTimeout(() => {
    if(container.contains(toast)) container.removeChild(toast);
  }, 30000);
}
