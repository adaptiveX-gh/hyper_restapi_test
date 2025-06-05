/** @jest-environment jsdom */
import { darkTheme } from '../public/js/core/themes/highchartsThemes.js';

describe('themeToggle component', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="theme-row">
        <label for="themeToggle" class="theme-switch">
          🌙 Dark mode
          <input type="checkbox" id="themeToggle" />
        </label>
      </div>`;
    localStorage.clear();
    window.Highcharts = { setOptions: jest.fn(), charts: [] };
  });

  test('saves state and updates theme', async () => {
    localStorage.setItem('qr-theme', 'light');
    await import('../public/js/core/themeToggle.js');
    const chk = document.getElementById('themeToggle');
    chk.checked = true;
    chk.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('qr-theme')).toBe('dark');
    expect(document.body.classList.contains('theme-dark')).toBe(true);
    expect(window.Highcharts.setOptions).toHaveBeenCalledWith(darkTheme);
  });
});
