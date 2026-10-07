import { accentShades, brandColorProblem, mix, navInk, normaliseHex } from './colors';

/**
 * The CSS-variable override for a company's colours, or '' for today's look. `html:root` outranks the
 * `@theme` `:root` defaults whatever the stylesheet order. Only valid, readable hex colours get through.
 */
export function brandingCss(colors: { brandColor: string | null; navColor: string | null }): string {
  const vars: string[] = [];
  const brand = colors.brandColor && normaliseHex(colors.brandColor);
  if (brand && !brandColorProblem(brand)) {
    const s = accentShades(brand);
    vars.push(`--color-accent:${s.accent}`, `--color-accent-strong:${s.strong}`, `--color-accent-soft:${s.soft}`);
  }
  const nav = colors.navColor && normaliseHex(colors.navColor);
  const ink = nav ? navInk(nav) : null;
  if (nav && ink) {
    vars.push(`--color-nav:${nav}`, `--color-nav-ink:${ink}`, `--color-nav-hover:${mix(nav, ink, 0.1)}`, `--color-nav-line:${mix(nav, ink, 0.18)}`);
  }
  return vars.length ? `html:root{${vars.join(';')}}` : '';
}
