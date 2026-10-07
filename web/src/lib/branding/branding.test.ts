import { describe, it, expect } from 'vitest';
import { DEFAULT_BRANDING, toBranding } from './branding';

describe('toBranding', () => {
  it('falls back to todays look without a row', () => {
    expect(toBranding(null)).toEqual(DEFAULT_BRANDING);
    expect(DEFAULT_BRANDING).toEqual({ name: 'Implant Course Manager', brandColor: null, navColor: null, logoUrl: null });
  });
  it('maps a row, versioning the logo URL', () => {
    expect(toBranding({ name: 'Acme Implants', brand_color: '#7c2d12', nav_color: null, logo_version: 3, has_logo: true })).toEqual({
      name: 'Acme Implants', brandColor: '#7c2d12', navColor: null, logoUrl: '/brand/logo?v=3',
    });
  });
  it('has no logo URL when the logo was removed, and the default name when blank', () => {
    expect(toBranding({ name: null, brand_color: null, nav_color: null, logo_version: 4, has_logo: false })).toEqual(DEFAULT_BRANDING);
  });
});
