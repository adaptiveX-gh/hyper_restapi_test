export function updateSpectrumBar(bearPct, bullPct) {
  const bar = document.getElementById('bullBearBar');
  if (!bar) return;
  const bearFill = bar.querySelector('.bear-fill');
  const bullFill = bar.querySelector('.bull-fill');
  const bearText = bar.querySelector('#bearPct');
  const bullText = bar.querySelector('#bullPct');
  const clamp = v => Math.max(0, Math.min(100, Number(v) || 0));
  const bear = clamp(bearPct);
  const bull = clamp(bullPct);
  if (bearFill) bearFill.style.width = `${bear / 2}%`;
  if (bullFill) bullFill.style.width = `${bull / 2}%`;
  if (bearText) bearText.textContent = `${Math.round(bear)}%`;
  if (bullText) bullText.textContent = `${Math.round(bull)}%`;
  if (window.radar && typeof window.radar.updatePong === 'function') {
    window.radar.updatePong({ bearPct: bear, bullPct: bull });
  }
}
