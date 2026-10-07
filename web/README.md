# Implant Course Manager — web app

Spec: `../docs/superpowers/specs/2026-10-01-implant-course-manager-design.md`

## First-time setup
Development and tests run on a **local Supabase stack** (Docker); only production is hosted.
1. Install Docker Desktop (Windows: WSL2 backend, `wsl --install` first) and start it.
2. `npm install`, then `npm run db:start` — starts the stack from `supabase/config.toml`
   (auth, MFA and email templates as on prod; emails land in Mailpit at http://127.0.0.1:54324).
3. `cp .env.example .env.local` and fill it in from `npm run db:status` (API URL, anon and service keys).
4. `npm run db:migrate` — the stack's own migration runner is off; this script owns `supabase/migrations`, as on prod.
5. `npm run create-user -- you@example.com "Your Name" --role admin` — prints a temporary password (re-run to reset it).
6. `npm run dev` → http://localhost:3000

## Tests
- `npm test` — unit tests
- `npm run test:db` — database tests against the local stack (each test rolls back)
- `npm run test:e2e` — browser tests (starts the dev server; creates `icm-test-*@example.com` users)

## Production notes
- Configure custom SMTP in Supabase, then the email templates, before inviting real users.
- Confirm hosting location with a legal advisor under Egypt PDPL (Law 151/2020) before go-live.
