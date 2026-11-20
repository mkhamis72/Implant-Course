# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Organizers and admins** (dentists) of implant courses in Egypt. They run courses where delegates place implants on real patients under supervision. Admins also manage users, permissions, supervisors, doctors, branding and plan settings.
- **Delegates**: course participants with a narrow read-only portal (`/my`): their own schedule and placement report.
- **Clinic staff** in Clinic-type companies. These companies have no teaching: doctors place implants and the course and delegate areas are hidden.
- **Platform operator** (Imploid): uses the console to add companies, set plans and modules, check health and errors.

Usage happens in three settings:
1. at a desk or laptop before and after course days (planning courses, receiving stock, reports, statistics);
2. on a phone or tablet in the clinic, chairside or in the surgery suite, often in a hurry;
3. on a shared clinic PC that several staff use.

## Product Purpose

One cloud system for running an implant course or clinic: patient records with an FDI implant odontogram, surgical and prosthetic stock with lot traceability and automatic deduction, the surgery schedule plus lectures and workshops, checklists, course and delegate reports, follow-up and outcome capture, and research statistics.

Success means:
- from any patient, every implant's status, component, placer and outcome is one step away;
- stock never goes negative and any lot traces to patient, tooth, date and placer;
- a surgery day's pull list flags shortages ahead of time;
- research data comes out clean enough to analyse.

## Positioning

Built around teaching courses and traceability, unlike general dental practice software. It records who placed or assisted each implant, under which supervisor, in which course, from which lot, and connects that to follow-up outcomes for research. Clinic mode reuses the same traceability without the teaching layer.

## Operating Context

- Multi-tenant: each company (academy or clinic) has its own address (`<name>.imploid.net`) and branding, all in one database. The console runs at `console.imploid.net`.
- Roles: admin, organizer (per-area None/View/Edit permissions), delegate. Modules (inventory, statistics, teaching) can be switched off per plan, which hides their areas.
- English UI. Cairo dates throughout.
- Sign-in with mandatory-capable TOTP 2FA. Emails (invites, resets, checklist notices) are sent from `noreply@imploid.net`.

## Capabilities and Constraints

- Next.js 15 / React 19 / Tailwind v4 / Supabase Postgres with RLS. The database holds the business rules.
- Design tokens live in `web/src/app/globals.css`. Use named colours and shared classes (`.btn`, `.card`, `.table` with `data-label` so tables stack on phones), never raw palette colours.
- A CSP allows only this site and Supabase. New external origins (fonts, images, scripts) must be added in `src/lib/security-headers.ts`.
- Data-dense operational screens (tables, odontogram, forms, schedules) must work at 360px and on desktop.
- Out of scope: billing, Arabic UI, deciduous teeth.

## Brand Commitments

- **Each company brands its own workspace**: name, brand colour, navigation colour and logo override the defaults, within the readability rules in `src/lib/branding/colors.ts`. Status colours (ok/warn/bad) are never branded.
- **Imploid is the platform brand**: it appears on the console, the bare-domain landing page and outgoing email. The landing page names no company.

## Evidence on Hand

- Real product catalogue: Oxy Implant PSK-MDK + MD EXT (`docs/catalog/oxy-catalog.csv`).
- Pilot companies in production: academy (`kaleidoscope.imploid.net`), osdic, demo.
- No testimonials, customer quotes, metrics or case studies exist. Do not invent them.

## Product Principles

1. **Traceability first**: every clinical action records who did it, under whom, with what, and when. The UI must never hide or blur provenance.
2. **The database decides**: rules and errors come from the server; the UI shows business errors verbatim and never invents its own rules.
3. **Fast in the clinic, thorough at the desk**: chairside flows are short and touch-friendly, and review and research screens can be dense.
4. **Each company feels like its own**: company branding leads inside the app, while Imploid stays in the background except on platform surfaces.
5. **Hide what's off**: switched-off modules and permissions remove areas completely instead of greying them out.
