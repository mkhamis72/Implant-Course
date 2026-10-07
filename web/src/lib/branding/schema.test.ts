import { describe, it, expect } from 'vitest';
import { brandingSchema } from './schema';

const err = (r: { error?: { issues: { message: string }[] } }) => r.error?.issues[0].message;
const base = { name: '', brand_color: '', nav_color: '' };

describe('brandingSchema', () => {
  it('turns blanks into null (= defaults)', () => {
    expect(brandingSchema.parse(base)).toEqual({ name: null, brand_color: null, nav_color: null });
    expect(brandingSchema.parse({ name: null, brand_color: null, nav_color: null })).toEqual({ name: null, brand_color: null, nav_color: null });
  });
  it('trims the name and normalises colours typed without # or in upper case', () => {
    expect(brandingSchema.parse({ name: '  Acme Implants ', brand_color: '7C2D12', nav_color: '#1E293B' })).toEqual({
      name: 'Acme Implants', brand_color: '#7c2d12', nav_color: '#1e293b',
    });
  });
  it('refuses a bad name, a non-colour and unreadable colours', () => {
    expect(err(brandingSchema.safeParse({ ...base, name: 'A' }))).toBe('Enter a name of 2–60 characters.');
    expect(err(brandingSchema.safeParse({ ...base, name: 'x'.repeat(61) }))).toBe('Enter a name of 2–60 characters.');
    expect(err(brandingSchema.safeParse({ ...base, brand_color: 'teal' }))).toBe('Enter a colour like #0f766e.');
    expect(err(brandingSchema.safeParse({ ...base, brand_color: '#fde68a' }))).toBe('This colour is too light to read on white. Choose a darker shade.');
    expect(err(brandingSchema.safeParse({ ...base, nav_color: '#777777' }))).toBe('Text can\'t be read on this navigation colour. Choose a lighter or darker shade.');
  });
});
