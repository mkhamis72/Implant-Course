# Implant Course Manager — web app

Spec: `../docs/superpowers/specs/2026-10-01-implant-course-manager-design.md`

## First-time setup
1. Create the Supabase project and auth settings described in
   `../docs/superpowers/plans/2026-10-01-plan-1-foundation.md` → Task 2 (manual prerequisite).
2. `cp .env.example .env.local` and fill it in. `DATABASE_URL` must be the **Session pooler**
   URI (the direct `db.<ref>.supabase.co` host is IPv6-only).
3. `npm install`
4. `npm run db:migrate`
5. `npm run create-admin -- you@example.com "Your Name"` — prints a temporary password.
6. `npm run dev` → http://localhost:3000

## Tests
- `npm test` — unit tests
- `npm run test:db` — database tests against the dev project (each test rolls back)
- `npm run test:e2e` — browser tests (starts the dev server; creates `icm-test-*@example.com` users)

## Production notes
- Configure custom SMTP in Supabase, then the email templates, before inviting real users.
- Confirm hosting location with a legal advisor under Egypt PDPL (Law 151/2020) before go-live.
