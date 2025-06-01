/** @jest-environment jsdom */
import { classifyObi } from '../public/js/core/utils.js';

describe('OBI DOM class', () => {
  test('flips classes based on ratio', () => {
    document.body.innerHTML = '<span id="obiRatio" class="obi-flat">--</span>';
    const el = document.getElementById('obiRatio');
    const cls = classifyObi(1.2);
    el.classList.remove('obi-bull','obi-bear','obi-flat');
    el.classList.add(`obi-${cls}`);
    expect(el.classList.contains('obi-bull')).toBe(true);
  });
});
