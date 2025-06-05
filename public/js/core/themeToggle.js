import { darkTheme, lightTheme } from './themes/highchartsThemes.js';

const KEY  = 'qr-theme';
const body = document.body;
const chk  = document.getElementById('themeToggle');

// initial state from storage
const start = (localStorage.getItem(KEY) || 'light') === 'dark';
applyTheme(start);
if (chk) {
  chk.checked = start;
  chk.addEventListener('change', () => applyTheme(chk.checked));
}

function applyTheme(dark) {
  if (chk) chk.disabled = true;
  body.style.cursor = 'progress';
  body.classList.toggle('theme-dark', dark);
  body.classList.toggle('theme-light', !dark);
  localStorage.setItem(KEY, dark ? 'dark' : 'light');

  if (window.Highcharts) {
    const theme = dark ? darkTheme : lightTheme;
    window.Highcharts.setOptions(theme);
    if (Array.isArray(window.Highcharts.charts)) {
      window.Highcharts.charts.forEach(c => c && c.update(theme.chart, false));
      window.Highcharts.charts.forEach(c => c && c.redraw(false));
    }
  }
  if (chk) chk.disabled = false;
  body.style.cursor = '';
}
