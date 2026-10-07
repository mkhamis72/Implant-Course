import { describe, it, expect } from 'vitest';
import { brandingCss } from './css';

describe('brandingCss', () => {
  it('is empty without branding (today\'s look)', () => {
    expect(brandingCss({ brandColor: null, navColor: null })).toBe('');
  });
  it('overrides the accent tokens', () => {
    expect(brandingCss({ brandColor: '#0f766e', navColor: null })).toBe(
      'html:root{--color-accent:#0f766e;--color-accent-strong:#0c5e58;--color-accent-soft:#e2efee}',
    );
  });
  it('overrides the nav tokens with a readable text colour', () => {
    expect(brandingCss({ brandColor: null, navColor: '#1e293b' })).toBe(
      'html:root{--color-nav:#1e293b;--color-nav-ink:#ffffff;--color-nav-hover:#353e4f;--color-nav-line:#47505e}',
    );
  });
  it('ignores anything that is not a valid, readable colour', () => {
    expect(brandingCss({ brandColor: 'red;}body{display:none', navColor: '#777777' })).toBe('');
    expect(brandingCss({ brandColor: '#fde68a', navColor: null })).toBe('');
  });
});
