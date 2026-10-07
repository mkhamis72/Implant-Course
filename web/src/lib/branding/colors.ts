/**
 * Company branding colours. Brand colour = the accent (links, buttons, focus); navigation colour = sidebar
 * and phone top bar. Readability is enforced here (WCAG contrast ≥ 4.5:1); status colours are never branded.
 */
export const INK = '#17262b';
export const WHITE = '#ffffff';
export const DEFAULT_ACCENT = '#0f766e';
export const MIN_CONTRAST = 4.5;
export const BRAND_COLOR_TOO_LIGHT = 'This colour is too light to read on white. Choose a darker shade.';
export const NAV_COLOR_UNREADABLE = "Text can't be read on this navigation colour. Choose a lighter or darker shade.";

const HEX = /^#[0-9a-f]{6}$/;

export function normaliseHex(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  const hex = v.startsWith('#') ? v : `#${v}`;
  return HEX.test(hex) ? hex : null;
}

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `a` moved towards `b` by `weightOfB` (0–1), per channel, rounded. */
export function mix(a: string, b: string, weightOfB: number): string {
  const ca = channels(a);
  const cb = channels(b);
  return `#${ca.map((c, i) => Math.round(c + (cb[i] - c) * weightOfB).toString(16).padStart(2, '0')).join('')}`;
}

export function brandColorProblem(hex: string): string | null {
  return contrast(hex, WHITE) >= MIN_CONTRAST ? null : BRAND_COLOR_TOO_LIGHT;
}

export function navInk(hex: string): string | null {
  const onInk = contrast(hex, INK);
  const onWhite = contrast(hex, WHITE);
  if (Math.max(onInk, onWhite) < MIN_CONTRAST) return null;
  return onInk >= onWhite ? INK : WHITE;
}

export function accentShades(hex: string): { accent: string; strong: string; soft: string } {
  return { accent: hex, strong: mix(hex, '#000000', 0.2), soft: mix(hex, WHITE, 0.88) };
}
