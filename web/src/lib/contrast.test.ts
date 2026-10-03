// Contrast floor for the design tokens in globals.css (WCAG 2.2: 1.4.3 text 4.5:1, 1.4.11 controls 3:1).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const css = readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8');
const token = (name: string) => {
  const m = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token ${name} not found`);
  return m[1];
};
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(token(a)), lum(token(b))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

describe('design token contrast', () => {
  it('text tokens reach 4.5:1 on every surface they sit on', () => {
    for (const fg of ['ink', 'muted', 'accent', 'bad']) {
      for (const bg of ['surface', 'canvas', 'sunken']) expect(ratio(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const [fg, bg] of [['ok', 'ok-soft'], ['warn', 'warn-soft'], ['bad', 'bad-soft'], ['accent-strong', 'accent-soft'], ['off', 'off-soft']]) {
      expect(ratio(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('form control borders reach 3:1 against the surface and the canvas', () => {
    expect(ratio('line-strong', 'surface')).toBeGreaterThanOrEqual(3);
    expect(ratio('line-strong', 'canvas')).toBeGreaterThanOrEqual(3);
  });
  it('placeholder text (subtle) reaches 4.5:1 on the input surface', () => {
    expect(ratio('subtle', 'surface')).toBeGreaterThanOrEqual(4.5);
  });
});
