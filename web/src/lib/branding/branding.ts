/** A company's branding as the app uses it; blank values fall back to today's look. */
export const DEFAULT_NAME = 'Implant Course Manager';

export type Branding = { name: string; brandColor: string | null; navColor: string | null; logoUrl: string | null };

/** One row of `public.branding_public()`. */
export type BrandingRow = { name: string | null; brand_color: string | null; nav_color: string | null; logo_version: number; has_logo: boolean };

export const DEFAULT_BRANDING: Branding = { name: DEFAULT_NAME, brandColor: null, navColor: null, logoUrl: null };

export function toBranding(row: BrandingRow | null): Branding {
  if (!row) return DEFAULT_BRANDING;
  return {
    name: row.name || DEFAULT_NAME,
    brandColor: row.brand_color,
    navColor: row.nav_color,
    logoUrl: row.has_logo ? `/brand/logo?v=${row.logo_version}` : null,
  };
}
