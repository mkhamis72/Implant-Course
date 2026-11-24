import path from 'node:path';
import { Font } from '@react-pdf/renderer';

// Bundled with the server (next.config.ts outputFileTracingIncludes); never fetched at render time.
const FONT_DIR = path.join(process.cwd(), 'src', 'lib', 'passport', 'fonts');

export const PASSPORT_FONT = 'Passport';
export const PASSPORT_ARABIC_FONT = 'PassportArabic';
// Use as `fontFamily`: Latin from Noto Sans, any glyph it lacks (Arabic) from the Arabic font.
export const PASSPORT_FONT_STACK = [PASSPORT_FONT, PASSPORT_ARABIC_FONT];

// Static instances, one file per weight: react-pdf (fontkit) uses only a variable font's default instance.
// Arabic: IBM Plex Sans Arabic, whose letters carry their dots. @react-pdf/render 4.x scales GPOS glyph
// offsets by fontSize / 1000 (so they are lost), and Noto Naskh / Noto Sans Arabic draw every letter dot
// as a positioned mark: their dots land beside and above the word (ن of حسن, ي of علي).
const FILES = [
  { fontWeight: 400, latin: 'NotoSans-Regular.ttf', arabic: 'IBMPlexSansArabic-Regular.ttf' },
  { fontWeight: 700, latin: 'NotoSans-Bold.ttf', arabic: 'IBMPlexSansArabic-Bold.ttf' },
] as const;

let registered = false;

/** Registers the passport fonts once per process. */
export function registerPassportFonts(): void {
  if (registered) return;
  Font.register({
    family: PASSPORT_FONT,
    fonts: FILES.map((f) => ({ src: path.join(FONT_DIR, f.latin), fontWeight: f.fontWeight })),
  });
  Font.register({
    family: PASSPORT_ARABIC_FONT,
    fonts: FILES.map((f) => ({ src: path.join(FONT_DIR, f.arabic), fontWeight: f.fontWeight })),
  });
  // Words are never split with hyphens (names, reference codes).
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
