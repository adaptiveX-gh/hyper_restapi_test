/** @jest-environment jsdom */
import { classifyObi, classifyBias } from '../public/js/core/utils.js';

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

describe('Rolling bias DOM class', () => {
  test('applies bull/bear/flat classes', () => {
    document.body.innerHTML = '<span id="biasRoll" class="obi-flat">--</span>' +
                             '<span id="biasRollTxt" class="obi-flat"></span>';
    const cls = classifyBias(0.4);
    const num = document.getElementById('biasRoll');
    const txt = document.getElementById('biasRollTxt');
    num.classList.remove('obi-bull','obi-bear','obi-flat');
    txt.classList.remove('obi-bull','obi-bear','obi-flat');
    num.classList.add(`obi-${cls}`);
    txt.classList.add(`obi-${cls}`);
    expect(num.classList.contains('obi-bull')).toBe(true);
    expect(txt.classList.contains('obi-bull')).toBe(true);
  });
});
