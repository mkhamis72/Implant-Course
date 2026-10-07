import { describe, it, expect } from 'vitest';
import {
  BRAND_COLOR_TOO_LIGHT, DEFAULT_ACCENT, INK, NAV_COLOR_UNREADABLE, WHITE,
  accentShades, brandColorProblem, contrast, mix, navInk, normaliseHex,
} from './colors';

describe('normaliseHex', () => {
  it.each([
    ['#0f766e', '#0f766e'],
    ['0F766E', '#0f766e'],
    ['  #1E293B ', '#1e293b'],
  ])('%s → %s', (raw, hex) => expect(normaliseHex(raw)).toBe(hex));
  it.each(['', 'red', '#fff', '#12345g', '#1234567'])('refuses %j', (raw) => expect(normaliseHex(raw)).toBeNull());
});

describe('contrast and mix', () => {
  it('computes WCAG ratios', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrast('#777777', WHITE)).toBeCloseTo(4.48, 2);
  });
  it('mixes channel by channel', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#0f766e', '#000000', 0.2)).toBe('#0c5e58');
  });
});

describe('brand colour', () => {
  it('accepts today\'s accent and dark colours', () => {
    expect(brandColorProblem(DEFAULT_ACCENT)).toBeNull();
    expect(brandColorProblem('#7c2d12')).toBeNull();
  });
  it('refuses colours too light for white text', () => {
    expect(brandColorProblem('#fde68a')).toBe(BRAND_COLOR_TOO_LIGHT);
    expect(brandColorProblem('#777777')).toBe(BRAND_COLOR_TOO_LIGHT);
    expect(BRAND_COLOR_TOO_LIGHT).toBe('This colour is too light to read on white. Choose a darker shade.');
  });
  it('derives a darker hover shade and a light tint', () => {
    expect(accentShades(DEFAULT_ACCENT)).toEqual({ accent: '#0f766e', strong: '#0c5e58', soft: '#e2efee' });
  });
});

describe('navigation colour', () => {
  it('picks the more readable text colour', () => {
    expect(navInk('#ffffff')).toBe(INK);
    expect(navInk('#1e293b')).toBe(WHITE);
    expect(navInk('#fde68a')).toBe(INK);
  });
  it('refuses mid-tones where neither reaches 4.5:1', () => {
    expect(navInk('#777777')).toBeNull();
    expect(NAV_COLOR_UNREADABLE).toBe("Text can't be read on this navigation colour. Choose a lighter or darker shade.");
  });
});
