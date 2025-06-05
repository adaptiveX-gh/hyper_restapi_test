import { darkTheme, lightTheme } from './themes/highchartsThemes.js';

const KEY   = 'qr-theme';
const body  = document.body;
const check = document.getElementById('themeToggle');

const saved = localStorage.getItem(KEY) || 'light';
body.classList.add(`theme-${saved}`);
if (check) check.checked = saved === 'dark';
function applyThemeToCharts(theme) {
  if (!window.Highcharts || !Array.isArray(window.Highcharts.charts)) return;
  window.Highcharts.charts.forEach(c => {
    if (c) c.update(theme, true, false);
  });
}

if (saved === 'dark' && window.Highcharts) {
  window.Highcharts.setOptions(darkTheme);
  applyThemeToCharts(darkTheme);
}

if (check) {
  check.addEventListener('change', () => {
    const dark = check.checked;
    body.classList.toggle('theme-dark', dark);
    body.classList.toggle('theme-light', !dark);
    localStorage.setItem(KEY, dark ? 'dark' : 'light');
    if (window.Highcharts) {
      const theme = dark ? darkTheme : lightTheme;
      window.Highcharts.setOptions(theme);
      applyThemeToCharts(theme);
    }
  });
}
