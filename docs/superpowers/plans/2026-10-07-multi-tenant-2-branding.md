# Multi-tenant part 2: Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each company's admin sets a name, logo, brand colour and navigation colour under Admin → Settings → Branding, and the whole app (including the signed-out login page and delegate pages) shows them; unbranded companies look exactly as today.

**Architecture:** Branding lives in each company's own database (`public.branding` + `public.branding_logos`, migration 0040), read through two public security-definer functions and written through three admin-only ones. The root layout reads it once per request (`getBranding()`), sets the title/icon, and injects a validated `:root` CSS-variable override; the logo is served by the app at `/brand/logo?v=<version>`. Colour readability is checked in pure TypeScript (`src/lib/branding/colors.ts`).

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind v4 (`@theme` tokens in `src/app/globals.css`), Zod v4, Supabase (Postgres plpgsql, PostgREST rpc), Vitest (jsdom unit/component, node DB), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-07-multi-tenant-2-branding-design.md`

## Global Constraints

- Run every command from `web/` (Git Bash on Windows). There's no Python; script with Node. Files containing `\` are written with the Write/Edit tools, not heredocs.
- Match the surrounding code: no Prettier, single quotes, 2-space indent, the same comment density. Use design tokens (`text-muted`, `border-line`, …), never raw Tailwind palette colours.
- Never print `.env*` contents. Never commit `.env*` or `tenants.local.json`.
- A company that never sets branding must look exactly as today: name "Implant Course Manager", accent `#0f766e`, white sidebar, today's mark.
- Name: 2–60 characters, trimmed; blank = default.
- Colours: stored as lower-case `#rrggbb`; blank = default.
- Brand colour must have contrast ≥ 4.5:1 against white, else exactly: "This colour is too light to read on white. Choose a darker shade."
- Navigation colour: nav text is ink `#17262b` or white `#ffffff`, whichever contrasts more; if neither reaches 4.5:1, exactly: "Text can't be read on this navigation colour. Choose a lighter or darker shade."
- Logo: PNG, JPEG or WebP, detected by signature bytes; at most 204800 bytes (200 KB); SVG refused.
- Admin-only writes fail with exactly "Only an admin can change branding."
- Status colours (ok/warn/bad/off) and the guided violet are never overridden.
- App migration `0040_branding.sql` is additive only (release migrates prod before deploying). Never edit migrations 0001–0039.
- Branding must never break a page: any read failure renders the defaults.

## Review Focus

1. **A disguised file uploaded as the logo** (an SVG or HTML file renamed `logo.png`): refused by signature, never stored or served. Test in Task 2 (`image.test.ts`).
2. **Colour typed without `#` or in upper case** (`0F766E`, `#1E293B`): accepted and stored normalised. Test in Task 2 (`schema.test.ts`).
3. **A large photo picked as the logo** (several MB): a clear message before upload, not a framework error page. Test in Task 6 (component test of the client-side size guard).
4. **The logo URL requested while signed out** (login page): served, not redirected to `/login`. Test in Task 4 (`redirects.test.ts`).
5. **A replaced logo**: shows immediately despite year-long caching (version in the URL changes); a bare `/brand/logo` without `?v=` isn't cached. Tests in Task 3 (DB: `logo_version` bumps on set and clear) and Task 4 (route cache header).

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/branding/colors.ts` | Hex parsing, contrast, mixing, derived accent shades, nav text choice, refusal messages (pure) |
| `src/lib/branding/css.ts` | `brandingCss()` → `html:root{…}` override string (pure) |
| `src/lib/branding/image.ts` | Logo signature sniffing, size limit, bytea hex encode/decode (pure) |
| `src/lib/branding/schema.ts` | Zod schema for the Branding form |
| `src/lib/branding/branding.ts` | `Branding` type, defaults, `toBranding(row)` (pure) |
| `src/lib/branding/get.ts` | `getBranding()` (server, cached per request, defaults on failure) |
| `supabase/migrations/0040_branding.sql` | Tables, triggers, five functions, grants |
| `tests/db/branding.test.ts` | DB behaviour; `tests/db/permissions.test.ts` allow-list |
| `src/app/brand/logo/route.ts` | Serves the logo |
| `src/lib/auth/redirects.ts` | `/brand/logo` is public |
| `src/app/layout.tsx` | Metadata, viewport theme colour, CSS override |
| `src/app/globals.css` | Nav tokens with today's defaults |
| `src/components/brand-mark.tsx` | Logo image or today's `Mark` |
| `src/components/nav.tsx`, `src/app/(app)/layout.tsx`, `src/app/login/page.tsx` | Show name/logo, nav tokens |
| `src/app/(app)/admin/settings/branding-form.tsx`, `actions.ts`, `page.tsx` | Admin UI and actions |
| `tests/e2e/branding.spec.ts`, `tests/e2e/isolation.spec.ts` | End-to-end |

---

### Task 1: Colour rules and the CSS override

**Files:**
- Create: `src/lib/branding/colors.ts`, `src/lib/branding/colors.test.ts`, `src/lib/branding/css.ts`, `src/lib/branding/css.test.ts`

**Interfaces:**
- Produces:
  - `INK = '#17262b'`, `WHITE = '#ffffff'`, `DEFAULT_ACCENT = '#0f766e'`
  - `normaliseHex(raw: string): string | null` (accepts with/without `#`, any case; returns lower-case `#rrggbb`)
  - `contrast(a: string, b: string): number` (WCAG ratio)
  - `mix(a: string, b: string, weightOfB: number): string`
  - `brandColorProblem(hex: string): string | null`, `BRAND_COLOR_TOO_LIGHT` (message)
  - `navInk(hex: string): string | null` (INK, WHITE, or null when unreadable), `NAV_COLOR_UNREADABLE` (message)
  - `accentShades(hex: string): { accent: string; strong: string; soft: string }`
  - `brandingCss(colors: { brandColor: string | null; navColor: string | null }): string` (from `css.ts`)

- [ ] **Step 1: Write the failing tests** `src/lib/branding/colors.test.ts`

```ts
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
  it('accepts today’s accent and dark colours', () => {
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
```

- [ ] **Step 2: Write the failing tests** `src/lib/branding/css.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { brandingCss } from './css';

describe('brandingCss', () => {
  it('is empty without branding (today’s look)', () => {
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
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npm test -- src/lib/branding`
Expected: FAIL, "Failed to resolve import './colors'" / "'./css'".

- [ ] **Step 4: Implement** `src/lib/branding/colors.ts`

```ts
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
```

- [ ] **Step 5: Implement** `src/lib/branding/css.ts`

```ts
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
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- src/lib/branding`
Expected: PASS. If an expected hex in a test differs by one in a channel, recompute it by hand from `mix()` (round half up per channel) before changing the test, and say so in the report.

- [ ] **Step 7: Commit**

```bash
git add src/lib/branding/colors.ts src/lib/branding/colors.test.ts src/lib/branding/css.ts src/lib/branding/css.test.ts
git commit -m "feat(branding): colour readability rules and CSS override"
```

---

### Task 2: Logo checks, form schema and the Branding type

**Files:**
- Create: `src/lib/branding/image.ts`, `image.test.ts`, `schema.ts`, `schema.test.ts`, `branding.ts`, `branding.test.ts` (all in `src/lib/branding/`)

**Interfaces:**
- Consumes: `normaliseHex`, `brandColorProblem`, `navInk`, `NAV_COLOR_UNREADABLE` (Task 1)
- Produces:
  - `MAX_LOGO_BYTES = 204800`, `type LogoType = 'image/png' | 'image/jpeg' | 'image/webp'`
  - `sniffLogo(bytes: Uint8Array): LogoType | null`, `logoProblem(bytes: Uint8Array): string | null`
  - `encodeBytea(bytes: Uint8Array): string` (`'\\x' + hex`), `decodeBytea(value: string): Uint8Array`
  - `brandingSchema` → `{ name: string | null; brand_color: string | null; nav_color: string | null }`
  - `DEFAULT_NAME = 'Implant Course Manager'`, `type Branding = { name: string; brandColor: string | null; navColor: string | null; logoUrl: string | null }`, `DEFAULT_BRANDING`, `type BrandingRow`, `toBranding(row: BrandingRow | null): Branding`

- [ ] **Step 1: Write the failing tests** `src/lib/branding/image.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { MAX_LOGO_BYTES, decodeBytea, encodeBytea, logoProblem, sniffLogo } from './image';

const bytes = (...b: number[]) => Uint8Array.from(b);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0);
const text = (s: string) => new TextEncoder().encode(s);

describe('sniffLogo', () => {
  it('recognises PNG, JPEG and WebP by their signature', () => {
    expect(sniffLogo(PNG)).toBe('image/png');
    expect(sniffLogo(JPEG)).toBe('image/jpeg');
    expect(sniffLogo(WEBP)).toBe('image/webp');
  });
  it('refuses SVG, HTML, GIF and RIFF files that are not WebP, whatever their name', () => {
    expect(sniffLogo(text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffLogo(text('<!doctype html><p>hi'))).toBeNull();
    expect(sniffLogo(text('GIF89a....'))).toBeNull();
    expect(sniffLogo(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45))).toBeNull();
  });
});

describe('logoProblem', () => {
  it('accepts a small image', () => expect(logoProblem(PNG)).toBeNull());
  it('refuses an empty file, a non-image and a file over 200 KB', () => {
    expect(logoProblem(new Uint8Array())).toBe('Choose an image file.');
    expect(logoProblem(text('<svg/>'))).toBe('The logo must be a PNG, JPEG or WebP image.');
    const big = new Uint8Array(MAX_LOGO_BYTES + 1);
    big.set(PNG);
    expect(logoProblem(big)).toBe('The logo must be 200 KB or smaller.');
    expect(MAX_LOGO_BYTES).toBe(204800);
  });
});

describe('bytea hex', () => {
  it('round-trips through the PostgREST hex format', () => {
    expect(encodeBytea(bytes(0x89, 0x50, 0x0a))).toBe('\\x89500a');
    expect(Array.from(decodeBytea('\\x89500a'))).toEqual([0x89, 0x50, 0x0a]);
  });
});
```

- [ ] **Step 2: Write the failing tests** `src/lib/branding/schema.test.ts`

```ts
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
    expect(err(brandingSchema.safeParse({ ...base, nav_color: '#777777' }))).toBe("Text can't be read on this navigation colour. Choose a lighter or darker shade.");
  });
});
```

- [ ] **Step 3: Write the failing tests** `src/lib/branding/branding.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_BRANDING, toBranding } from './branding';

describe('toBranding', () => {
  it('falls back to today’s look without a row', () => {
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
```

- [ ] **Step 4: Run them to verify they fail**

Run: `npm test -- src/lib/branding`
Expected: FAIL on the three new files ("Failed to resolve import").

- [ ] **Step 5: Implement** `src/lib/branding/image.ts`

```ts
/** Company logo upload rules: PNG, JPEG or WebP by signature (never by name or browser type), ≤ 200 KB. */
export const MAX_LOGO_BYTES = 204800;
export type LogoType = 'image/png' | 'image/jpeg' | 'image/webp';

export function sniffLogo(bytes: Uint8Array): LogoType | null {
  const starts = (sig: number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

export function logoProblem(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return 'Choose an image file.';
  if (bytes.length > MAX_LOGO_BYTES) return 'The logo must be 200 KB or smaller.';
  if (!sniffLogo(bytes)) return 'The logo must be a PNG, JPEG or WebP image.';
  return null;
}

/** bytea in PostgREST's text form: `\x` followed by hex. */
export function encodeBytea(bytes: Uint8Array): string {
  return `\\x${Buffer.from(bytes).toString('hex')}`;
}

export function decodeBytea(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value.replace(/^\\x/, ''), 'hex'));
}
```

- [ ] **Step 6: Implement** `src/lib/branding/schema.ts`

```ts
import { z } from 'zod';
import { NAV_COLOR_UNREADABLE, brandColorProblem, navInk, normaliseHex } from './colors';

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v ?? null);
const NAME_MESSAGE = 'Enter a name of 2–60 characters.';

const color = (problem: (hex: string) => string | null) =>
  z.preprocess(
    blankToNull,
    z
      .string()
      .nullable()
      .transform((v, ctx) => {
        if (v === null) return null;
        const hex = normaliseHex(v);
        if (!hex) {
          ctx.addIssue({ code: 'custom', message: 'Enter a colour like #0f766e.' });
          return z.NEVER;
        }
        const message = problem(hex);
        if (message) {
          ctx.addIssue({ code: 'custom', message });
          return z.NEVER;
        }
        return hex;
      }),
  );

/** Admin → Settings → Branding. Null means "use the default". */
export const brandingSchema = z.object({
  name: z.preprocess(blankToNull, z.string().trim().min(2, { message: NAME_MESSAGE }).max(60, { message: NAME_MESSAGE }).nullable()),
  brand_color: color(brandColorProblem),
  nav_color: color((hex) => (navInk(hex) ? null : NAV_COLOR_UNREADABLE)),
});
```

- [ ] **Step 7: Implement** `src/lib/branding/branding.ts`

```ts
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
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test -- src/lib/branding`
Expected: PASS (all branding tests).

- [ ] **Step 9: Commit**

```bash
git add src/lib/branding
git commit -m "feat(branding): logo signature checks, form schema and Branding type"
```

---

### Task 3: Database: tables and functions (migration 0040)

**Files:**
- Create: `supabase/migrations/0040_branding.sql`, `tests/db/branding.test.ts`
- Modify: `tests/db/permissions.test.ts` (allow-list near line 260)

**Interfaces:**
- Produces (rpc names and named parameters used by Tasks 4–7):
  - `branding_public()` → rows of `{ name, brand_color, nav_color, logo_version, has_logo }` (one row) — `anon`, `authenticated`
  - `branding_logo()` → rows of `{ bytes, content_type }` (zero or one) — `anon`, `authenticated`
  - `update_branding(p_name text, p_brand_color text, p_nav_color text)` → void — admins
  - `set_branding_logo(p_bytes bytea, p_content_type text)` → void — admins
  - `clear_branding_logo()` → void — admins
  - Check constraint names (in error messages): `branding_name_check`, `branding_brand_color_check`, `branding_nav_color_check`, `branding_logos_bytes_check`, `branding_logos_content_type_check`

- [ ] **Step 1: Write the failing test** `tests/db/branding.test.ts`

```ts
import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs } from './helpers';

const users = inject('testUsers');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

const pub = (c: Client) => c.query('select * from public.branding_public()').then((r) => r.rows[0]);
const update = (c: Client, name: string | null, brand: string | null, nav: string | null) =>
  c.query('select public.update_branding($1, $2, $3)', [name, brand, nav]);
const setLogo = (c: Client, bytes: Buffer, type = 'image/png') => c.query('select public.set_branding_logo($1, $2)', [bytes, type]);

describe('branding', () => {
  it('starts unbranded and is readable while signed out, but the tables are not', async () => {
    await withTx(async (c) => {
      await actAs(c, null);
      expect(await pub(c)).toMatchObject({ name: null, brand_color: null, nav_color: null, has_logo: false });
      expect((await c.query('select * from public.branding_logo()')).rows).toEqual([]);
      await refused(c, () => c.query('select * from public.branding'), /permission denied/);
      await refused(c, () => c.query('select * from public.branding_logos'), /permission denied/);
      await refused(c, () => update(c, 'Acme Implants', null, null), /permission denied/);
    });
  });

  it('lets an admin set name, colours (normalised) and a logo; anon reads them back', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      await update(c, '  Acme Implants ', '#7C2D12', ' #1e293b ');
      await setLogo(c, PNG);
      await actAs(c, null);
      const row = await pub(c);
      expect(row).toMatchObject({ name: 'Acme Implants', brand_color: '#7c2d12', nav_color: '#1e293b', has_logo: true });
      const logo = (await c.query('select * from public.branding_logo()')).rows[0];
      expect(logo.content_type).toBe('image/png');
      expect(Buffer.compare(logo.bytes, PNG)).toBe(0);
    });
  });

  it('bumps the logo version on every upload and removal', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      const v0 = (await pub(c)).logo_version as number;
      await setLogo(c, PNG);
      await setLogo(c, PNG, 'image/webp');
      expect((await pub(c)).logo_version).toBe(v0 + 2);
      await c.query('select public.clear_branding_logo()');
      expect(await pub(c)).toMatchObject({ logo_version: v0 + 3, has_logo: false });
      expect((await c.query('select * from public.branding_logo()')).rows).toEqual([]);
    });
  });

  it('refuses non-admins, including an organizer with Edit everywhere and a delegate login', async () => {
    await withTx(async (c) => {
      for (const user of [users.organizer, users.delegate]) {
        await actAs(c, user);
        await refused(c, () => update(c, 'Acme Implants', null, null), /./);
        await refused(c, () => setLogo(c, PNG), /./);
        await refused(c, () => c.query('select public.clear_branding_logo()'), /./);
      }
      await actAs(c, users.organizer);
      await refused(c, () => update(c, 'Acme Implants', null, null), /Only an admin can change branding/);
    });
  });

  it('enforces formats and sizes', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      await refused(c, () => update(c, 'A', null, null), /branding_name_check/);
      await refused(c, () => update(c, null, 'red', null), /branding_brand_color_check/);
      await refused(c, () => update(c, null, null, '#12345'), /branding_nav_color_check/);
      await refused(c, () => setLogo(c, Buffer.alloc(204801, 1)), /branding_logos_bytes_check/);
      await refused(c, () => setLogo(c, PNG, 'image/svg+xml'), /branding_logos_content_type_check/);
      await update(c, '', '', '');
      expect(await pub(c)).toMatchObject({ name: null, brand_color: null, nav_color: null });
    });
  });

  it('records branding changes in the history without the logo bytes', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      await setLogo(c, PNG);
      await c.query('reset role');
      const { rows } = await c.query(
        `select count(*) filter (where table_name = 'branding')::int as branding,
                count(*) filter (where table_name = 'branding_logos')::int as logos,
                bool_and(not (coalesce(after, '{}'::jsonb) ? 'bytes')) as no_bytes
         from public.audit_log where table_name in ('branding', 'branding_logos')
           and at >= now()`,
      );
      expect(rows[0]).toEqual({ branding: 1, logos: 0, no_bytes: true });
    });
  });
});
```

`now()` is constant inside the test's transaction, so `at >= now()` selects only this test's audit rows.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:db -- branding`
Expected: FAIL, "function public.branding_public() does not exist".

- [ ] **Step 3: Write the migration** `supabase/migrations/0040_branding.sql`

```sql
-- Branding (multi-tenant part 2): each company's name, colours and logo, in its own database.
-- Read by anyone (the login page renders before sign-in) through two definer functions; the tables
-- themselves stay closed. Written by admins only. Logo bytes live in their own table without the
-- audit trigger, so audit_log never stores images; every logo change bumps branding.logo_version,
-- which is audited.
create table public.branding (
  id boolean primary key default true check (id),
  name text check (name is null or length(trim(name)) between 2 and 60),
  brand_color text check (brand_color ~ '^#[0-9a-f]{6}$'),
  nav_color text check (nav_color ~ '^#[0-9a-f]{6}$'),
  logo_version int not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.branding default values;

create table public.branding_logos (
  id boolean primary key default true check (id),
  bytes bytea not null check (octet_length(bytes) between 1 and 204800),
  content_type text not null check (content_type in ('image/png', 'image/jpeg', 'image/webp'))
);

alter table public.branding enable row level security;
alter table public.branding_logos enable row level security;
revoke all on public.branding, public.branding_logos from public, anon, authenticated;

create trigger branding_set_updated_at before update on public.branding
  for each row execute function app_private.set_updated_at();
create trigger branding_audit after insert or update or delete on public.branding
  for each row execute function app_private.audit_row('id');

create function public.branding_public()
returns table (name text, brand_color text, nav_color text, logo_version int, has_logo boolean)
language sql stable security definer set search_path = '' as $$
  select b.name, b.brand_color, b.nav_color, b.logo_version, exists (select 1 from public.branding_logos)
  from public.branding b where b.id
$$;

create function public.branding_logo()
returns table (bytes bytea, content_type text)
language sql stable security definer set search_path = '' as $$
  select l.bytes, l.content_type from public.branding_logos l where l.id
$$;

create function public.update_branding(p_name text, p_brand_color text, p_nav_color text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_active();
  if not public.is_admin() then
    perform app_private.fail('Only an admin can change branding.');
  end if;
  update public.branding set
    name = nullif(trim(coalesce(p_name, '')), ''),
    brand_color = lower(nullif(trim(coalesce(p_brand_color, '')), '')),
    nav_color = lower(nullif(trim(coalesce(p_nav_color, '')), ''))
  where id;
end $$;

create function public.set_branding_logo(p_bytes bytea, p_content_type text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_active();
  if not public.is_admin() then
    perform app_private.fail('Only an admin can change branding.');
  end if;
  insert into public.branding_logos (id, bytes, content_type) values (true, p_bytes, p_content_type)
  on conflict (id) do update set bytes = excluded.bytes, content_type = excluded.content_type;
  update public.branding set logo_version = logo_version + 1 where id;
end $$;

create function public.clear_branding_logo() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_active();
  if not public.is_admin() then
    perform app_private.fail('Only an admin can change branding.');
  end if;
  delete from public.branding_logos where id;
  update public.branding set logo_version = logo_version + 1 where id;
end $$;

revoke execute on function public.branding_public(), public.branding_logo() from public;
grant execute on function public.branding_public(), public.branding_logo() to anon, authenticated;
revoke execute on function public.update_branding(text, text, text), public.set_branding_logo(bytea, text),
  public.clear_branding_logo() from public, anon;
grant execute on function public.update_branding(text, text, text), public.set_branding_logo(bytea, text),
  public.clear_branding_logo() to authenticated;
```

- [ ] **Step 4: Add the five functions to the permissions allow-list** in `tests/db/permissions.test.ts` (the `allow` set in "every public security-definer function checks a permission or is allow-listed"):

```ts
      const allow = new Set([
        'is_active_user', 'is_admin', 'is_delegate_user', 'my_delegate_id', 'can',
        'set_user_permissions', 'delete_user', 'my_schedule', 'my_report', 'next_file_no',
        // Branding (0040): public readers for the signed-out login page; admin-only writers.
        'branding_public', 'branding_logo', 'update_branding', 'set_branding_logo', 'clear_branding_logo',
      ]);
```

- [ ] **Step 5: Dry-run the migration in a rolled-back transaction** (CLAUDE.md Gotchas), with this one-off command (don't add a script to the repo):

```bash
node -e "const {Client}=require('pg');const fs=require('fs');(async()=>{const c=new Client({connectionString:'postgresql://postgres:postgres@127.0.0.1:54322/postgres'});await c.connect();try{await c.query('begin');await c.query(fs.readFileSync('supabase/migrations/0040_branding.sql','utf8'));console.log('dry-run OK')}finally{await c.query('rollback');await c.end()}})().catch(e=>{console.error(e.message);process.exit(1)})"
```

Expected: `dry-run OK`. (Local stack only: the URL is the local Supabase DB.)

- [ ] **Step 6: Run the DB tests to verify they pass**

Run: `npm run test:db -- branding permissions`
Expected: PASS (applies 0040 to the local stack first).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0040_branding.sql tests/db/branding.test.ts tests/db/permissions.test.ts
git commit -m "feat(branding): branding tables, public readers and admin-only writers (0040)"
```

---

### Task 4: Serving branding: getBranding, the logo route, the public path and the root layout

**Files:**
- Create: `src/lib/branding/get.ts`, `src/app/brand/logo/route.ts`, `src/app/brand/logo/route.test.ts`
- Modify: `src/lib/auth/redirects.ts:4`, `src/lib/auth/redirects.test.ts`, `src/app/layout.tsx`

**Interfaces:**
- Consumes: `toBranding`, `DEFAULT_BRANDING`, `Branding`, `BrandingRow` (Task 2); `decodeBytea` (Task 2); `brandingCss` (Task 1); rpc `branding_public`, `branding_logo` (Task 3)
- Produces: `getBranding(): Promise<Branding>` (React-`cache`d, never throws except Next's own control-flow errors); route `GET /brand/logo`

- [ ] **Step 1: Write the failing tests.** Add to the `it.each` table in `src/lib/auth/redirects.test.ts` (the one containing `['/login', 'public']`):

```ts
    ['/brand/logo', 'public'],
```

Create `src/app/brand/logo/route.test.ts` (Node environment, for the standard `Request`/`Response`):

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const maybeSingle = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc: () => ({ maybeSingle }) }),
}));

import { GET } from './route';

const req = (url: string) => new Request(url);

describe('GET /brand/logo', () => {
  beforeEach(() => maybeSingle.mockReset());

  it('serves the stored bytes with their type, cached long when versioned', async () => {
    maybeSingle.mockResolvedValue({ data: { bytes: '\\x89504e47', content_type: 'image/png' }, error: null });
    const res = await GET(req('http://localhost:3000/brand/logo?v=3'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('is not cached without a version', async () => {
    maybeSingle.mockResolvedValue({ data: { bytes: '\\x89504e47', content_type: 'image/png' }, error: null });
    expect((await GET(req('http://localhost:3000/brand/logo'))).headers.get('cache-control')).toBe('no-cache');
  });

  it('is 404 when there is no logo or the read fails', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await GET(req('http://localhost:3000/brand/logo?v=1'))).status).toBe(404);
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect((await GET(req('http://localhost:3000/brand/logo?v=1'))).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- redirects route`
Expected: FAIL (`/brand/logo` classified 'protected'; `./route` not found).

- [ ] **Step 3: Make the logo path public** in `src/lib/auth/redirects.ts`:

```ts
// /brand/logo: the company logo, shown on the login page before anyone signs in.
const PUBLIC_PATHS = new Set(['/login', '/auth/confirm', '/auth/error', '/brand/logo']);
```

- [ ] **Step 4: Implement the route** `src/app/brand/logo/route.ts`

```ts
import { createClient } from '@/lib/supabase/server';
import { decodeBytea } from '@/lib/branding/image';

/** The current company's logo. Versioned URLs (?v=) change on every upload, so they can be cached for a year. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('branding_logo').maybeSingle<{ bytes: string; content_type: string }>();
  if (error || !data) return new Response(null, { status: 404 });
  const versioned = new URL(request.url).searchParams.has('v');
  return new Response(Buffer.from(decodeBytea(data.bytes)), {
    headers: {
      'Content-Type': data.content_type,
      'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'no-cache',
    },
  });
}
```

- [ ] **Step 5: Implement** `src/lib/branding/get.ts`

```ts
import 'server-only';
import { cache } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { DEFAULT_BRANDING, toBranding, type Branding, type BrandingRow } from './branding';

/** The current company's branding, read once per request. Never breaks a page: any failure → today's look. */
export const getBranding = cache(async (): Promise<Branding> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('branding_public').maybeSingle<BrandingRow>();
    return error ? DEFAULT_BRANDING : toBranding(data);
  } catch (e) {
    unstable_rethrow(e); // Next's own signals (dynamic rendering, redirects) must pass through
    return DEFAULT_BRANDING;
  }
});
```

- [ ] **Step 6: Use it in the root layout** `src/app/layout.tsx` (replace the static `metadata`/`viewport` exports and the component):

```tsx
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { getBranding } from '@/lib/branding/get';
import { brandingCss } from '@/lib/branding/css';
import { DEFAULT_ACCENT } from '@/lib/branding/colors';
import './globals.css';

// Self-hosted at build time; no request to Google at runtime.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getBranding();
  return {
    title: branding.name,
    description: 'Patients, implants, inventory and courses for implant-course organizers',
    ...(branding.logoUrl ? { icons: { icon: branding.logoUrl } } : {}),
  };
}

export async function generateViewport(): Promise<Viewport> {
  const branding = await getBranding();
  return { width: 'device-width', initialScale: 1, themeColor: branding.brandColor ?? DEFAULT_ACCENT };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The company's colours as CSS variables; brandingCss only lets validated hex colours through.
  const css = brandingCss(await getBranding());
  return (
    <html lang="en" className={inter.variable}>
      <head>{css && <style>{css}</style>}</head>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 7: Run the tests, typecheck and lint**

Run: `npm test -- redirects route branding && npx tsc --noEmit && npm run lint`
Expected: PASS, no type errors, no lint warnings.

- [ ] **Step 8: Commit**

```bash
git add src/lib/branding/get.ts src/app/brand src/lib/auth/redirects.ts src/lib/auth/redirects.test.ts src/app/layout.tsx
git commit -m "feat(branding): serve the logo, read branding per request, apply it in the root layout"
```

---

### Task 5: Show the name, logo and navigation colour

**Files:**
- Create: `src/components/brand-mark.tsx`, `src/components/brand-mark.test.tsx`
- Modify: `src/app/globals.css` (`@theme`, after the guided colours), `src/components/nav.tsx`, `src/app/(app)/layout.tsx`, `src/app/login/page.tsx`

**Interfaces:**
- Consumes: `getBranding()` (Task 4), `Branding` (Task 2)
- Produces: `BrandMark({ logoUrl, className? })`; `Nav` gains prop `brand: { name: string; logoUrl: string | null }`; Tailwind utilities `bg-nav`, `text-nav-ink`, `hover:bg-nav-hover`, `border-nav-line`

- [ ] **Step 1: Write the failing test** `src/components/brand-mark.test.tsx`

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { BrandMark } from './brand-mark';

describe('BrandMark', () => {
  it('shows the company logo when there is one', () => {
    const { container } = render(<BrandMark logoUrl="/brand/logo?v=3" />);
    expect(container.querySelector('img')?.getAttribute('src')).toContain('/brand/logo?v=3');
    expect(container.querySelector('svg')).toBeNull();
  });
  it('falls back to today’s mark', () => {
    const { container } = render(<BrandMark logoUrl={null} />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- brand-mark`
Expected: FAIL ("Failed to resolve import './brand-mark'").

- [ ] **Step 3: Implement** `src/components/brand-mark.tsx`

```tsx
import Image from 'next/image';
import { Mark } from './mark';

/** The company logo (decorative next to its name), or the product mark when none is set. */
export function BrandMark({ logoUrl, className = 'h-7 w-7' }: { logoUrl: string | null; className?: string }) {
  if (!logoUrl) return <Mark className={className} />;
  return <Image src={logoUrl} alt="" width={36} height={36} unoptimized className={`${className} shrink-0 object-contain`} />;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- brand-mark`
Expected: PASS.

- [ ] **Step 5: Add the nav tokens** to `src/app/globals.css` inside `@theme`, right after `--color-guided-soft`:

```css
  /* Navigation (sidebar, phone top bar). A company's navigation colour overrides these (src/lib/branding/css.ts). */
  --color-nav: #ffffff;
  --color-nav-ink: #17262b;
  --color-nav-hover: #eaf0ee;
  --color-nav-line: #d9e2df;
```

- [ ] **Step 6: Use the tokens and the brand in** `src/components/nav.tsx`:
  - `import { BrandMark } from './brand-mark';` replaces `import { Mark } from './mark';`
  - `Wordmark` becomes:

```tsx
function Wordmark({ brand }: { brand: { name: string; logoUrl: string | null } }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight text-nav-ink">
      <BrandMark logoUrl={brand.logoUrl} />
      <span className="leading-tight">{brand.name}</span>
    </Link>
  );
}
```

  - `Nav`'s signature: `export function Nav({ role, permissions, name, brand }: { role: Role; permissions: Permissions; name: string; brand: { name: string; logoUrl: string | null } })`; both `<Wordmark />` become `<Wordmark brand={brand} />`.
  - Class changes (exact replacements):
    - header: `border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur` → `border-b border-nav-line bg-nav px-4 py-2.5`
    - aside: `flex-col border-r border-line bg-surface p-4` → `flex-col border-r border-nav-line bg-nav p-4`
    - inactive link: `'text-ink hover:bg-sunken'` → `'text-nav-ink hover:bg-nav-hover'` (the active `bg-accent-soft font-semibold text-accent-strong` pill stays)
    - footer: `border-t border-line pt-4` → `border-t border-nav-line pt-4`; `truncate px-3 font-medium text-ink` → `truncate px-3 font-medium text-nav-ink`
    - Account security link and Sign out button: `text-muted hover:bg-sunken hover:text-ink` → `text-nav-ink hover:bg-nav-hover`

- [ ] **Step 7: Pass the brand from** `src/app/(app)/layout.tsx`:

```tsx
import { getBranding } from '@/lib/branding/get';
```

and inside `AppLayout`, after `const tenant = await currentTenant();`:

```tsx
  const branding = await getBranding();
```

and the `<Nav … />` element becomes:

```tsx
      <Nav
        role={profile.role}
        permissions={profile.permissions}
        name={profile.full_name || profile.email}
        brand={{ name: branding.name, logoUrl: branding.logoUrl }}
      />
```

- [ ] **Step 8: Brand the login page** `src/app/login/page.tsx`: replace `import { Mark } from '@/components/mark';` with

```tsx
import { BrandMark } from '@/components/brand-mark';
import { getBranding } from '@/lib/branding/get';
```

add `const branding = await getBranding();` as the first line of `LoginPage`, and replace the header block with:

```tsx
        <div className="flex items-center gap-3">
          <BrandMark logoUrl={branding.logoUrl} className="h-9 w-9" />
          <h1 className="text-xl font-semibold">{branding.name}</h1>
        </div>
```

- [ ] **Step 9: Typecheck, lint, unit tests**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all pass (no other test renders `Nav`; if one does, add `brand={{ name: 'Implant Course Manager', logoUrl: null }}`).

- [ ] **Step 10: Commit**

```bash
git add src/components/brand-mark.tsx src/components/brand-mark.test.tsx src/app/globals.css src/components/nav.tsx "src/app/(app)/layout.tsx" src/app/login/page.tsx
git commit -m "feat(branding): company name, logo and navigation colour in the nav and on the login page"
```

---

### Task 6: Admin → Settings → Branding

**Files:**
- Create: `src/app/(app)/admin/settings/branding-form.tsx`, `src/app/(app)/admin/settings/branding-form.test.tsx`
- Modify: `src/app/(app)/admin/settings/actions.ts`, `src/app/(app)/admin/settings/page.tsx`

**Interfaces:**
- Consumes: `brandingSchema` (Task 2), `logoProblem`, `sniffLogo`, `encodeBytea`, `MAX_LOGO_BYTES` (Task 2), `brandColorProblem`, `navInk`, `normaliseHex`, `NAV_COLOR_UNREADABLE`, `DEFAULT_ACCENT`, `INK`, `WHITE` (Task 1), `Branding`, `DEFAULT_NAME` (Task 2), `getBranding` (Task 4), rpc `update_branding`, `set_branding_logo`, `clear_branding_logo` (Task 3); `ActionState` from `@/lib/admin/schemas`, `userMessage` from `@/lib/db-errors`, `requireAdmin` from `@/lib/auth/session`
- Produces: server actions `saveBranding(prev: ActionState, formData: FormData)`, `removeLogo(prev: ActionState)`, `resetBranding(prev: ActionState)`; `BrandingForm({ branding }: { branding: Branding })`

- [ ] **Step 1: Write the failing component test** `src/app/(app)/admin/settings/branding-form.test.tsx`

```tsx
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BrandingForm } from './branding-form';

vi.mock('./actions', () => ({ saveBranding: vi.fn(), removeLogo: vi.fn(), resetBranding: vi.fn() }));

const unbranded = { name: 'Implant Course Manager', brandColor: null, navColor: null, logoUrl: null };

describe('BrandingForm', () => {
  it('starts from today’s look: blank fields with the defaults as placeholders, no logo actions', () => {
    render(<BrandingForm branding={unbranded} />);
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('placeholder', 'Implant Course Manager');
    expect(screen.getByRole('textbox', { name: 'Brand colour' })).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Remove logo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeInTheDocument();
  });

  it('shows saved values and the current logo', () => {
    render(<BrandingForm branding={{ name: 'Acme Implants', brandColor: '#7c2d12', navColor: '#1e293b', logoUrl: '/brand/logo?v=2' }} />);
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Acme Implants');
    expect(screen.getByRole('textbox', { name: 'Navigation colour' })).toHaveValue('#1e293b');
    expect(screen.getByRole('img', { name: 'Current logo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove logo' })).toBeInTheDocument();
  });

  it('warns while typing a colour that is too light or unreadable', () => {
    render(<BrandingForm branding={unbranded} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Brand colour' }), { target: { value: '#fde68a' } });
    expect(screen.getByText('This colour is too light to read on white. Choose a darker shade.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Navigation colour' }), { target: { value: '777777' } });
    expect(screen.getByText("Text can't be read on this navigation colour. Choose a lighter or darker shade.")).toBeInTheDocument();
  });

  it('refuses a logo over 200 KB before uploading it', () => {
    render(<BrandingForm branding={unbranded} />);
    const input = screen.getByLabelText(/Logo/) as HTMLInputElement;
    const big = new File([new Uint8Array(204801)], 'photo.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [big] } });
    expect(screen.getByRole('alert')).toHaveTextContent('The logo must be 200 KB or smaller.');
    expect(input.value).toBe('');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- branding-form`
Expected: FAIL ("Failed to resolve import './branding-form'").

- [ ] **Step 3: Add the actions** to `src/app/(app)/admin/settings/actions.ts`. Add imports:

```ts
import { userMessage } from '@/lib/db-errors';
import { brandingSchema } from '@/lib/branding/schema';
import { encodeBytea, logoProblem, sniffLogo } from '@/lib/branding/image';
```

and append:

```ts
const branding = (ok: string): ActionState => {
  revalidatePath('/', 'layout');
  return { ok };
};

export async function saveBranding(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = brandingSchema.safeParse({
    name: formData.get('name'), brand_color: formData.get('brand_color'), nav_color: formData.get('nav_color'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  // Check the logo before saving anything, so a bad file never leaves a half-saved change.
  const file = formData.get('logo');
  const bytes = file instanceof File && file.size > 0 ? new Uint8Array(await file.arrayBuffer()) : null;
  const problem = bytes && logoProblem(bytes);
  if (problem) return { error: problem };
  const supabase = await createClient();
  const { error } = await supabase.rpc('update_branding', {
    p_name: parsed.data.name, p_brand_color: parsed.data.brand_color, p_nav_color: parsed.data.nav_color,
  });
  if (error) return { error: userMessage(error) ?? 'Could not save the branding.' };
  if (bytes) {
    const { error: logoError } = await supabase.rpc('set_branding_logo', { p_bytes: encodeBytea(bytes), p_content_type: sniffLogo(bytes)! });
    if (logoError) return { error: userMessage(logoError) ?? 'Could not save the logo.' };
  }
  return branding('Branding saved.');
}

export async function removeLogo(_prev: ActionState): Promise<ActionState> {
  await requireAdmin();
  const { error } = await (await createClient()).rpc('clear_branding_logo');
  if (error) return { error: userMessage(error) ?? 'Could not remove the logo.' };
  return branding('Logo removed.');
}

export async function resetBranding(_prev: ActionState): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc('update_branding', { p_name: null, p_brand_color: null, p_nav_color: null });
  if (error) return { error: userMessage(error) ?? 'Could not reset the branding.' };
  const { error: logoError } = await supabase.rpc('clear_branding_logo');
  if (logoError) return { error: userMessage(logoError) ?? 'Could not remove the logo.' };
  return branding('Branding reset to the defaults.');
}
```

(Check `userMessage`'s parameter type in `src/lib/db-errors.ts`; the Supabase `PostgrestError` is what other actions pass to it.)

- [ ] **Step 4: Implement the form** `src/app/(app)/admin/settings/branding-form.tsx`

```tsx
'use client';

import { useActionState, useRef, useState } from 'react';
import Image from 'next/image';
import type { ActionState } from '@/lib/admin/schemas';
import { DEFAULT_NAME, type Branding } from '@/lib/branding/branding';
import { DEFAULT_ACCENT, INK, NAV_COLOR_UNREADABLE, WHITE, brandColorProblem, navInk, normaliseHex } from '@/lib/branding/colors';
import { MAX_LOGO_BYTES } from '@/lib/branding/image';
import { removeLogo, resetBranding, saveBranding } from './actions';

function ColorField(p: { name: string; label: string; value: string; onChange: (v: string) => void; fallback: string; problem: string | null }) {
  const hex = normaliseHex(p.value);
  return (
    <div className="space-y-1">
      <label className="block">
        <span className="label">{p.label}</span>
        <span className="flex items-center gap-2">
          <input
            type="color"
            aria-hidden="true"
            tabIndex={-1}
            className="h-10 w-12 shrink-0 cursor-pointer rounded border border-line-strong bg-surface"
            value={hex ?? p.fallback}
            onChange={(e) => p.onChange(e.target.value)}
          />
          <input className="input" name={p.name} value={p.value} placeholder={`Default (${p.fallback})`} onChange={(e) => p.onChange(e.target.value)} />
        </span>
      </label>
      {p.problem && <p className="text-sm text-bad">{p.problem}</p>}
    </div>
  );
}

/** Name, colours and logo of this company; blank fields use today's defaults. */
export function BrandingForm({ branding }: { branding: Branding }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveBranding, {});
  const [removeState, removeAction, removing] = useActionState<ActionState>(removeLogo, {});
  const [resetState, resetAction, resetting] = useActionState<ActionState>(resetBranding, {});
  const [brand, setBrand] = useState(branding.brandColor ?? '');
  const [nav, setNav] = useState(branding.navColor ?? '');
  const [fileError, setFileError] = useState<string | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);

  const brandHex = normaliseHex(brand);
  const navHex = normaliseHex(nav);
  const brandProblem = brandHex ? brandColorProblem(brandHex) : null;
  const navText = navHex ? navInk(navHex) : null;
  const navProblem = navHex && !navText ? NAV_COLOR_UNREADABLE : null;
  const previewAccent = brandHex && !brandProblem ? brandHex : DEFAULT_ACCENT;
  const message = fileError ?? state.error ?? removeState.error ?? resetState.error;
  const ok = state.ok ?? removeState.ok ?? resetState.ok;

  return (
    <div className="card max-w-xl space-y-4">
      <form action={action} className="space-y-4" key={branding.logoUrl ?? 'no-logo'}>
        <label className="block">
          <span className="label">Name</span>
          <input className="input" name="name" defaultValue={branding.name === DEFAULT_NAME ? '' : branding.name} placeholder={DEFAULT_NAME} />
        </label>
        <ColorField name="brand_color" label="Brand colour" value={brand} onChange={setBrand} fallback={DEFAULT_ACCENT} problem={brandProblem} />
        <ColorField name="nav_color" label="Navigation colour" value={nav} onChange={setNav} fallback={WHITE} problem={navProblem} />
        <div aria-hidden="true" className="flex items-center gap-3 rounded-md border border-line p-3 text-sm"
          style={{ background: navHex && navText ? navHex : WHITE, color: navText ?? INK }}>
          <span className="font-semibold">Preview</span>
          <span className="rounded px-2 py-1 text-white" style={{ background: previewAccent }}>Button</span>
          <span className="underline" style={{ color: navHex && navText ? navText : previewAccent }}>Link</span>
        </div>
        <label className="block">
          <span className="label">Logo (PNG, JPEG or WebP, up to 200 KB)</span>
          <input
            ref={logoInput}
            className="input"
            type="file"
            name="logo"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && file.size > MAX_LOGO_BYTES) {
                setFileError('The logo must be 200 KB or smaller.');
                e.target.value = '';
              } else setFileError(null);
            }}
          />
        </label>
        {branding.logoUrl && (
          <Image src={branding.logoUrl} alt="Current logo" width={48} height={48} unoptimized className="h-12 w-12 object-contain" />
        )}
        {message && <p role="alert" className="text-sm text-bad">{message}</p>}
        {ok && !message && <p role="status" className="text-sm text-ok">{ok}</p>}
        <div className="flex flex-wrap gap-2">
          <button className="btn" disabled={pending}>Save branding</button>
          {branding.logoUrl && (
            <button className="btn-secondary btn" formAction={removeAction} disabled={removing}>Remove logo</button>
          )}
          <button className="btn-secondary btn" formAction={resetAction} disabled={resetting}>Reset to defaults</button>
        </div>
      </form>
    </div>
  );
}
```

Note: Remove logo and Reset use `formAction` on their own buttons (one form, no nesting). Their actions ignore the form data. After Reset, the colour fields keep their typed values until the page re-renders with the new `branding` prop; the `key` on the form plus `revalidatePath` refresh it. If the colour state doesn't follow the new props after Reset in the E2E (Task 7), add `key={`${branding.brandColor}|${branding.navColor}|${branding.logoUrl}`}` on `<BrandingForm>` in `page.tsx` so the component remounts with fresh state.

- [ ] **Step 5: Add it to the Settings page** `src/app/(app)/admin/settings/page.tsx`:

```tsx
import { getSettings, requireAdmin } from '@/lib/auth/session';
import { getBranding } from '@/lib/branding/get';
import { SettingsForm } from './settings-form';
import { BrandingForm } from './branding-form';

export default async function SettingsPage() {
  await requireAdmin();
  const [settings, branding] = await Promise.all([getSettings(), getBranding()]);
  return (
    <div className="space-y-6">
      <h1>Settings</h1>
      <SettingsForm settings={settings} />
      <section className="space-y-3" aria-labelledby="branding-heading">
        <h2 id="branding-heading" className="text-lg font-semibold">Branding</h2>
        <p className="text-sm text-muted">Your company’s name, colours and logo, shown to everyone including on the sign-in page. Blank fields use the defaults.</p>
        <BrandingForm key={`${branding.brandColor}|${branding.navColor}|${branding.logoUrl}`} branding={branding} />
      </section>
    </div>
  );
}
```

- [ ] **Step 6: Run the tests, typecheck and lint**

Run: `npm test -- branding-form && npx tsc --noEmit && npm run lint`
Expected: PASS. If `screen.getByLabelText(/Logo/)` matches more than one element, narrow it to `/^Logo/`.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/admin/settings"
git commit -m "feat(branding): Admin → Settings → Branding (name, colours, logo, reset)"
```

---

### Task 7: End-to-end tests and docs

**Files:**
- Create: `tests/e2e/branding.spec.ts`
- Modify: `tests/e2e/isolation.spec.ts`, `CLAUDE.md` (Architecture, after the "Companies (multi-tenant, part 1)" paragraph)

**Interfaces:**
- Consumes: the Branding UI (Task 6) with labels "Name", "Brand colour", "Navigation colour", "Logo (PNG, JPEG or WebP, up to 200 KB)", buttons "Save branding", "Remove logo", "Reset to defaults", section "Branding"; rpc `update_branding`, `clear_branding_logo` (Task 3); `#main-nav` (nav aside id)

- [ ] **Step 1: Write the spec** `tests/e2e/branding.spec.ts`

```ts
import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { apiAs } from './api';

// 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

// Branding is company-wide: always put the local company back to today's look.
test.afterEach(async () => {
  const admin = await apiAs(TEST_USERS.admin.email);
  await admin.rpc('update_branding', { p_name: null, p_brand_color: null, p_nav_color: null });
  await admin.rpc('clear_branding_logo');
});

test('an admin brands the company; the app and the signed-out login page show it', async ({ page, browser }) => {
  await login(page, TEST_USERS.admin.email);
  await page.goto('/admin/settings');
  const form = page.getByRole('region', { name: 'Branding' });
  await form.getByRole('textbox', { name: 'Name' }).fill('E2E Acme Implants');
  await form.getByRole('textbox', { name: 'Brand colour' }).fill('#7C2D12');
  await form.getByRole('textbox', { name: 'Navigation colour' }).fill('1e293b');
  await form.getByLabel('Logo (PNG, JPEG or WebP, up to 200 KB)').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await form.getByRole('button', { name: 'Save branding' }).click();
  await expect(form.getByRole('status')).toHaveText('Branding saved.');

  await page.reload();
  await expect(page.locator('#main-nav')).toHaveCSS('background-color', 'rgb(30, 41, 59)');
  await expect(page.locator('#main-nav')).toContainText('E2E Acme Implants');
  await expect(form.getByRole('button', { name: 'Save branding' })).toHaveCSS('background-color', 'rgb(124, 45, 18)');
  await expect(page).toHaveTitle('E2E Acme Implants');

  const anon = await browser.newContext();
  const login2 = await anon.newPage();
  await login2.goto('/login');
  await expect(login2.getByRole('heading', { level: 1 })).toHaveText('E2E Acme Implants');
  const logo = login2.locator('main img').first();
  await expect(logo).toHaveAttribute('src', /\/brand\/logo\?v=\d+/);
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await anon.close();
});

test('refuses a brand colour too light to read', async ({ page }) => {
  await login(page, TEST_USERS.admin.email);
  await page.goto('/admin/settings');
  const form = page.getByRole('region', { name: 'Branding' });
  await form.getByRole('textbox', { name: 'Brand colour' }).fill('#fde68a');
  await form.getByRole('button', { name: 'Save branding' }).click();
  await expect(form.getByRole('alert')).toHaveText('This colour is too light to read on white. Choose a darker shade.');
});

test('Reset to defaults restores today’s look', async ({ page }) => {
  const admin = await apiAs(TEST_USERS.admin.email);
  await admin.rpc('update_branding', { p_name: 'E2E Reset Me', p_brand_color: '#7c2d12', p_nav_color: '#1e293b' });
  await login(page, TEST_USERS.admin.email);
  await page.goto('/admin/settings');
  await expect(page.locator('#main-nav')).toContainText('E2E Reset Me');
  await page.getByRole('region', { name: 'Branding' }).getByRole('button', { name: 'Reset to defaults' }).click();
  await expect(page.locator('#main-nav')).toContainText('Implant Course Manager');
  await expect(page.locator('#main-nav')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});
```

- [ ] **Step 2: Run it**

Make sure nothing listens on :3000 (`Get-NetTCPConnection -LocalPort 3000` in PowerShell) or reuse a running `npm run dev`.
Run: `npx playwright test branding --project=chromium`
Expected: 3 passed. Fix the app (not the assertions) if a check fails; the assertions encode the spec. If `rpc` calls in `afterEach` need the admin to be aal2, they don't: test users have no 2FA.

- [ ] **Step 3: Add the company-isolation check** to `tests/e2e/isolation.spec.ts`. Extend the `tenants` type with `anonKey: string`, and add inside `test.describe('company isolation', …)`:

```ts
  test("company B's branding never shows on company A", async ({ page }) => {
    const b = createClient(dev2!.supabaseUrl, dev2!.anonKey, { auth: { persistSession: false } });
    const { error: signInError } = await b.auth.signInWithPassword({ email: dev2Email, password: PASSWORD });
    if (signInError) throw signInError;
    try {
      const { error } = await b.rpc('update_branding', { p_name: 'Dev2 Academy', p_brand_color: null, p_nav_color: null });
      expect(error).toBeNull();
      await page.goto(`${B}/login`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dev2 Academy');
      await page.goto('http://localhost:3000/login');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Implant Course Manager');
    } finally {
      await b.rpc('update_branding', { p_name: null, p_brand_color: null, p_nav_color: null });
    }
  });
```

The dev2 stack needs migration 0040 first: `npm run db:dev2:start`, then `ENV_FILE=.env.dev2 npm run db:migrate` (first line must show the dev2 host).
Run (nothing on :3000 first, so Playwright starts a server with the env): `TENANTS_FILE=tenants.local.json npx playwright test isolation --project=chromium`
Expected: 7 passed. Then `npx playwright test isolation --project=chromium` → 7 skipped. Then `npm run db:dev2:stop`.

- [ ] **Step 4: Document** in `CLAUDE.md`, as a new paragraph right after the "**Companies (multi-tenant, part 1):**" paragraph:

```markdown
**Branding (multi-tenant part 2, 0040):** each company's name, brand colour, navigation colour and logo live in its own database (`public.branding`, `public.branding_logos`; logo bytes are kept out of `audit_log`, `logo_version` is audited). Anyone reads them through `branding_public()` / `branding_logo()` (the login page renders before sign-in); admins write through `update_branding` / `set_branding_logo` / `clear_branding_logo` (Admin → Settings → Branding). `getBranding()` (`src/lib/branding/get.ts`) reads it once per request and falls back to the defaults on any failure; the root layout sets the title, icon and an `html:root` CSS-variable override (`brandingCss`), and `/brand/logo?v=<version>` (public path) serves the logo. Readability rules are in `src/lib/branding/colors.ts`; status colours are never branded. Nav colours use the `bg-nav` / `text-nav-ink` / `hover:bg-nav-hover` / `border-nav-line` tokens.
```

- [ ] **Step 5: Full verification**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run test:db`
Then E2E in parts (check free memory first): `npx playwright test branding auth admin headers mobile --project=chromium` plus `npx playwright test mobile` (phone project).
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/branding.spec.ts tests/e2e/isolation.spec.ts CLAUDE.md
git commit -m "test(e2e): branding end to end and across companies; docs"
```
