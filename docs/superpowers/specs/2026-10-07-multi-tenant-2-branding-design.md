# Multi-tenant, part 2: branding

Date: 2026-10-07. Builds on part 1 (`2026-10-07-multi-tenant-1-tenant-aware-app-design.md`), which is live: production routes through the control project.

## Context and goals

The owner wants to demo and sell the app to other course organizers, each seeing their own branded version. Where demos run (an online demo company or the owner's laptop) is undecided, so branding must work for any registered company, local or hosted, with no extra setup per company beyond what part 1 already needs.

Success: an admin of a company sets a name, a logo, a brand colour and a navigation colour under Admin → Settings → Branding; everyone in that company, including the signed-out login page and delegate logins, sees them; another company is unaffected; a company that never sets branding looks exactly as the app does today.

## Decisions

| Topic | Decision |
|---|---|
| Where branding lives | In each company's own database (app migration), not the control project. Backups and isolation come for free. |
| Colours | Two: a brand colour (accent) and a navigation colour. Status colours (ok/warn/bad/off) and the guided-technique violet stay fixed so their meaning never changes. |
| Logo storage | Bytes in the company's database, served by the app at `/brand/logo`. Not Supabase Storage: no CSP change, Storage stays off locally, data-only backups include it. |
| Logo formats | PNG, JPEG, WebP; at most 200 KB. SVG refused (it can carry script). |
| Readability | Enforced in the app (TypeScript, unit-tested), not in SQL: it's presentation, not data integrity. The database enforces formats and sizes. |
| Who edits | Admins only, like the rest of Admin → Settings. |
| Emails | Out of scope (Supabase Auth templates are per project; part 5). |

## What the admin edits

Admin → Settings gets a **Branding** section:

| Field | Rules | Blank / default |
|---|---|---|
| Name | 2–60 characters, trimmed | "Implant Course Manager" |
| Logo | PNG/JPEG/WebP ≤ 200 KB; upload, replace, remove; preview | today's mark (`components/mark.tsx`) |
| Brand colour | `#rrggbb`, colour picker plus text field | today's accent `#0f766e` |
| Navigation colour | `#rrggbb`, colour picker plus text field | today's surface (white) sidebar |

**Reset to defaults** clears all four. Saving shows a preview of the nav bar, a button and a link with the chosen colours before and after save.

Readability rules (`src/lib/branding/colors.ts`):
- Brand colour must have contrast ≥ 4.5:1 against white (it's link text and the background of white button text). The app derives `accent-strong` (darker, for hover) and `accent-soft` (light tint) from it. Too light → "This colour is too light to read on white. Choose a darker shade."
- Navigation colour: the app picks the nav text colour, ink (`#17262b`) or white, whichever contrasts more, and derives the active-link highlight. If neither reaches 4.5:1 → "Text can't be read on this navigation colour. Choose a lighter or darker shade."

## Where it shows

- **Browser tab:** `<title>` is the company name; the tab icon is the logo when set.
- **Login page** (signed out): logo and name.
- **Signed-in layout:** the sidebar (≥1024px) and the phone top bar show logo and name on the navigation colour; links, buttons, focus rings and highlights use the brand colour. Delegate `/my` pages share this layout.
- **Not branded:** the part-1 "Not found" / "temporarily unavailable" pages (they never reach a company database), status colours, the guided violet, emails.

## Database (app migration `0040_branding.sql`, additive)

```sql
public.branding        -- one row (id boolean primary key default true check (id)), inserted by the migration
  name text null                check (name is null or length(trim(name)) between 2 and 60)
  brand_color text null         check (brand_color ~ '^#[0-9a-f]{6}$')
  nav_color text null           check (nav_color ~ '^#[0-9a-f]{6}$')
  logo_version int not null default 0     -- bumped on every logo upload or removal
  updated_at timestamptz not null default now()

public.branding_logos  -- at most one row (id boolean pk true); no audit trigger (keeps bytes out of audit_log)
  bytes bytea not null          check (octet_length(bytes) between 1 and 204800)
  content_type text not null    check (content_type in ('image/png', 'image/jpeg', 'image/webp'))
```

- Colours are stored lower case; blank = default.
- `branding` gets the usual `audit_row('id')` and `set_updated_at` triggers; every logo change bumps `logo_version`, so the history log records it without the bytes.
- Neither table is readable or writable directly by `anon` or `authenticated` (no grants, RLS on).
- **Public reads** (granted to `anon` and `authenticated`, `security definer`, `stable`):
  - `public.branding_public()` → `(name, brand_color, nav_color, logo_version)`, never the bytes.
  - `public.branding_logo()` → `(bytes, content_type)`, or no row.
- **Writes** (granted to `authenticated` only; like `delete_user` (0037) they start with `perform app_private.require_active();` then `if not public.is_admin() then perform app_private.fail('Only an admin can change branding.'); end if;`):
  - `public.update_branding(p_name text, p_brand_color text, p_nav_color text)`: blank → null, trims, lower-cases.
  - `public.set_branding_logo(p_bytes bytea, p_content_type text)`: upserts the logo row, bumps `logo_version`.
  - `public.clear_branding_logo()`: deletes the logo row, bumps `logo_version`.
  - Reset to defaults = `update_branding(null, null, null)` + `clear_branding_logo()`.
- None of the five functions calls `require_perm` (branding isn't a permission area), so all five join the allow-list in `tests/db/permissions.test.ts` ("every public security-definer function checks a permission or is allow-listed"), next to `delete_user`.
- The previous app version ignores both tables, so the migration is safe in the release window.

## App

| File | Responsibility |
|---|---|
| `src/lib/branding/colors.ts` | Parse hex, relative luminance and contrast ratio, derived shades, nav text choice, the two refusals. Pure; unit-tested. |
| `src/lib/branding/schema.ts` | Zod schema for the form (name, colours) using `colors.ts`. |
| `src/lib/branding/image.ts` | Sniff PNG/JPEG/WebP by signature bytes; size limit. Pure; unit-tested. |
| `src/lib/branding/get.ts` | `getBranding()`: React `cache()`d per request, calls `branding_public()` with the current tenant's anon client; returns defaults on error (branding must never break a page). |
| `src/lib/branding/css.ts` | Builds the `:root { --color-accent…; --color-nav…; }` override from validated values. |
| `src/app/layout.tsx` | `generateMetadata` (title, icon `/brand/logo?v=…`), inline `<style>` with the override (CSP already allows inline styles; values are validated hex only). |
| `src/app/brand/logo/route.ts` | GET: `branding_logo()` for the current tenant; 404 when none; `Content-Type` from the row; `Cache-Control: public, max-age=31536000, immutable` (URLs carry `?v=`). Goes through middleware (not a root image extension), so the tenant is set. |
| `src/components/nav.tsx`, `mark.tsx`, `src/app/login/page.tsx` | Logo (`<img src="/brand/logo?v=…">`) or the default mark; company name; nav uses new tokens `bg-nav`, `text-nav-ink`, `bg-nav-active`. |
| `src/app/globals.css` | Adds `--color-nav`, `--color-nav-ink`, `--color-nav-active` defaulting to today's values (surface, ink, sunken). |
| `src/app/(app)/admin/settings/branding-form.tsx`, `actions.ts` | Form + actions (`requireAdmin()`); logo via `<input type="file">`, checked server-side by `image.ts` before `set_branding_logo`. Server actions' body limit raised just enough for a 200 KB file if needed. |

Failure handling: if branding can't be read (database hiccup), pages render with the defaults; the logo route returns 404 and the default mark shows. Saving errors use the normal `userMessage()` path.

## Testing

- **Unit:** `colors.ts` (known contrast ratios, derived shades, both refusals, default passes), `image.ts` (each signature, SVG/GIF/text refused, size limit), schema, `css.ts` output.
- **Component:** Branding form (defaults, preview, remove logo, reset).
- **DB (`tests/db/branding.test.ts`):** anon reads `branding_public()` and `branding_logo()` but not the tables; only admins can write (organizer with every area on Edit refused, delegate refused); format, size and type checks; `logo_version` bumps; audit row written without bytes; permissions test green with the two allow-listed readers.
- **E2E (`tests/e2e/branding.spec.ts`):** admin sets name, both colours and a logo → signed-out login page shows the name and logo; the nav has the navigation colour; a button uses the brand colour; too-light colour refused; Reset restores defaults. **Isolation spec:** brand company B, confirm company A's login page unchanged (runs only with `TENANTS_FILE`).

## Out of scope

- Per-company email templates and sender (part 5).
- Custom fonts, dark mode, more colours.
- Branding the control/console (part 4).
