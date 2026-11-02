# Release 3: company-aware app

Owner steps, in order. Production project `kshsgwvwqvufqdxcyvat`, company host `kaleidoscope.imploid.net`. Release 3 applies migrations 0086-0088 and control migration `0004_tenant_company.sql`, then deploys the app. Nothing here changes a prod setting until section (b).

## (a) Before shipping

1. Release 2 must be live and its checklist done (`release-2-checklist.md`).
2. **Auth sign-ups must stay OFF** (Supabase -> Authentication -> Sign In / Providers -> "Allow new users to sign up" off). A pending login (0088) grants its role to any `auth.users` insert with that email, so open sign-ups would let a stranger claim it.
3. Ship: switch the repo public, `cd web && ./scripts/ship.sh ship`, then private again.
4. After Release finishes (it migrates the control project, then every company, before deploying), check that academy's control row has its company. Read-only, in the control project's SQL editor:

   ```sql
   select slug, company_id from public.tenants where slug = 'academy';
   ```

   `company_id` must be `a7c0de00-0000-4000-8000-000000000001`. A tenant with a null company is served as suspended (503). `npm run tenant:check -- academy` (with `ENV_FILE=.env.prod`) must also end with `OK`, but it does not print the company.

## (b) After the deploy has gone live (1-3 minutes after Release turns green)

1. Confirm the new app is live: it passes `redirectTo` on every Auth email. Do not touch the templates before this, or links would point at the Site URL of a version that ignores them.
2. Supabase -> Authentication -> URL Configuration -> Redirect URLs: add `https://*.imploid.net/**`. Keep the existing entries.
3. Supabase -> Authentication -> Email Templates: switch the two links. Keep the old text for rollback.

   | Template | Old (rollback) | New |
   | --- | --- | --- |
   | Invite user | `<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite">Accept the invitation and set your password</a>` | `<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite">Accept the invitation and set your password</a>` |
   | Reset password | `<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery">` (keep the existing link text) | `<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery">` (same text) |

   `{{ .RedirectTo }}` is `https://<the request's host>/auth/confirm`, so each company's link returns to its own address.
4. Send a test invite (Admin -> Users -> Create login, a mailbox you own) and a password reset (login page -> Forgot password?). Open each link: it must land on `https://kaleidoscope.imploid.net/auth/confirm...` and then "Set a password".
5. If a link is wrong, put the old template text back (table above). The app still accepts both forms.

## (c) Smoke test on `kaleidoscope.imploid.net`

- Sign in with 2FA.
- Admin -> Users lists the people as before.
- A checklist item: the assignee picker lists staff.
- Sign in as a delegate: `/my` shows the schedule and report.

## (d) Prod check

Read-only; `begin read only`, prints `Target project` first, no secrets. From `web/`:

```bash
ENV_FILE=.env.prod NODE_PATH=node_modules npx tsx scripts/session-check.ts --tenant academy
```

Expected: `academy: N sessions` and `PASS`. Any other company id in the list prints `PROBLEM` and `FAIL`. Run it after the smoke test, so at least one session is bound.

## Rollback

Put the old template text back (b.3). The release-2 app keeps working against the new schema, so rolling the deploy back is also safe; migrations 0086-0088 and control 0004 are additive.
