# Plan: set up a new company from one console form (multi-tenant part 5)

## Context
Setting up OSDIC took several manual steps:
- the console **New company** form, which asks for the Supabase URL and three keys even though every company now shares one database;
- adding the address in Vercel (**Add Existing**) and a CNAME record in GoDaddy;
- the first admin, who gets a one-time password the owner passes on by hand.

The owner wants to set up the next company **themselves from the console**, with the **web address done automatically** and the **first admin invited by email**.

**Outcome:** one form (company name, address, admin name and email), then a status panel. The company is reachable at `<slug>.imploid.net` within a few minutes, and the admin has an invite email. Nothing is done in Vercel or GoDaddy for each company.

Branch `feat/company-onboarding` from `origin/master`, worktree `D:\Claude\Claude Code\implant-course-one-db`. At the start, commit this plan as the design doc `docs/superpowers/specs/2026-11-08-company-onboarding-design.md`.

## One-time setup (owner, before release)
1. **GoDaddy:** add the record type `CNAME`, name `*`, value `cname.vercel-dns.com`.
   - Existing records (kaleidoscope, osdic, console, www, Resend's email records) keep priority, because a wildcard only answers names with no record of their own.
2. **Vercel:**
   - Create an access token (Account → Tokens) scoped to the team that owns `implant-course`.
   - Add these Production env vars: `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID` (Project → Settings → General), and `VERCEL_TEAM_ID` if the project is under a team.
   - The token is server-only; only console actions use it.

## Behaviour (my calls unless marked as the owner's)
**New company form** (`/console/companies/new`), replacing today's fields:
- **Fields:**
  - name;
  - slug (prefilled from the name, editable);
  - address (prefilled `<slug>.<base domain>`, editable);
  - first admin's full name and email.
- **No keys.** The shared project's URL and keys are copied from the registry row of the tenant that serves academy (Vault `tenant_secret`). The **Replace keys** form on the company page stays for rotations.
- **Steps on submit, in order.** Each step is safe to retry, and the result lands on the company page:
  1. `console_register_tenant` (control), with the copied secrets.
  2. `provision_company` (shared DB, 0095), then `console_set_company`.
  3. **Address:** add each host to the Vercel project through the API.
     - If the Vercel vars are missing (local dev, tests), skip this step and show the manual steps instead.
  4. **First admin invite (the owner's choice):**
     - `console_add_first_admin`, then send the invite from the shared Auth: `inviteUserByEmail(email, { redirectTo: https://<first host>/auth/confirm })`.
     - If the invite fails, cancel the pending login, as `createFirstAdmin` already does.
- **Base domain:** the parent of `CONSOLE_HOST` (console.imploid.net → imploid.net).

**First-admin cases** (all three are my calls):
- **New address:** an invite email. The admin sets their own password and 2FA.
- **This company's own existing login:**
  - never signed in: re-send the invite (`generateLink` type invite, as `auth-accounts.ts` does);
  - signed in before: a password-reset email with the same `redirectTo`.
- **An account another company uses:** add the membership, keep their password, and send a short notice email ("You're now admin of X at https://host") through `sendEmail` (`src/lib/email/send.ts`).
- **With `EMAIL_ENABLED=false`:** keep today's one-time-password path, so local and pilot setups still work.

**Company page: a new "Address" panel, one line per host.**
- **States:**
  - "Live" when Vercel reports the domain verified and correctly configured;
  - "Waiting for certificate (usually 1–2 min)";
  - "Not added to Vercel", with an **Add to Vercel** button that retries.
- Status comes from the Vercel API (`GET /v9/projects/{id}/domains/{d}` and `GET /v6/domains/{d}/config`).
- **Without the Vercel vars:** the manual checklist (Vercel Add Existing, plus GoDaddy only if no wildcard).
- **Saving a host in "Edit company":** a new host is added to Vercel automatically. A removed host is **not** removed from Vercel; that's harmless and avoids accidents. The panel says so.

**Registry delay:** a new host can 404 for up to 60 s (registry cache `FRESH_MS`, `src/lib/tenant/control.ts`). The status panel says "may take a minute". No change to the cache.

## Code
- **`src/lib/console/vercel.ts`** (new, server-only; `fetch` with a timeout, tested with a mocked fetch):
  - `vercelConfigured(env)`
  - `addProjectDomain(host)`, where 409 "already added to this project" counts as success
  - `domainStatus(host)`, returning `'live' | 'pending' | 'missing'`
- **`src/lib/console/shared-project.ts`** (new): `sharedProjectSecrets(control)` reads URL, anon, service role and database URL from academy's tenant row through `tenant_secret`. It errors clearly if that row is missing.
- **`src/lib/console/first-admin.ts`:** add `inviteFirstAdmin(db, {companyId, email, fullName, host})`, returning `'invited' | 'reinvited' | 'reset_sent' | 'added'`. It reuses the lookups and cancel path of `createFirstAdmin`, which stays for `EMAIL_ENABLED=false`.
- **`src/lib/console/schemas.ts`:** `onboardSchema` with slug, name, hosts and admin email and name. `registerSchema` keys go.
- **`src/app/console/(admin)/actions.ts`:**
  - `registerCompany` becomes `onboardCompany`: the steps above, logging each step to `console_log`. Add `first_admin_invited` and `domain_added` to the actions it accepts, in **control migration 0006**: `create or replace console_log` with the wider check, same signature.
  - `updateCompany` also adds new hosts to Vercel.
  - New `addDomain` action for the retry button.
  - `firstAdmin` switches to the invite when email is on.
- **UI:**
  - `companies/new/register-form.tsx` becomes the new form;
  - `companies/[slug]/page.tsx` and `forms.tsx` get the Address panel and the invite wording.
- **Security:** the token is read only in `vercel.ts`, never logged or sent to the browser. Every action still calls `requireConsoleAdmin()`. Errors from Vercel are shortened to their message.
- **Docs:**
  - `docs/operations.md` §G (onboarding now one form, plus the one-time setup);
  - root `CLAUDE.md` (the line "A new company address needs two things…", part 5 marked done);
  - `web/.env.example` (the three Vercel vars, commented).
- **No shared-database migration.** The control database gets migration 0006 only.

## Tests
- **Unit:**
  - `vercel.test.ts`: add OK; 409 counted as OK; status mapping; not configured.
  - `shared-project.test.ts`.
  - `schemas.test.ts`: slug and host prefills, admin email.
  - `first-admin` invite cases with a mocked Supabase client: new, reinvite, reset, added (notice sent), invite failure cancels the pending login.
  - The existing console action tests updated.
- **Control DB:** `console_log` accepts the new actions (the existing control test pattern).
- **E2E `tests/e2e/console*.spec.ts`** (`npm run console:local` setup, no Vercel vars):
  - onboard a company with admin email;
  - the invite arrives in Mailpit, with a link to the company host;
  - the Address panel shows the manual checklist;
  - a retried onboarding with the same slug finishes the steps without duplicating anything.

## Verification
- `./scripts/ship.sh verify console` (plus the console E2E steps from CLAUDE.md: `npm run console:local`, then the console spec with nothing on :3000).
- **After release (owner):**
  1. Do the one-time setup.
  2. Onboard a test company, e.g. "Demo" at `demo.imploid.net`, with an admin email you can read.
  3. Watch the Address panel turn Live, open the invite, and sign in.
  4. Suspend "Demo" afterwards.
- Ship with `ship.sh ship`. The owner runs it, with the repo public before and private after.
