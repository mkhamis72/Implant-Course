# One database, plan 3 — SDD ledger (rulings, deferred minors, parked findings)

Copied from the git-ignored SDD workspace when plan 3 finished (2026-11-06).


Spec: docs/superpowers/specs/2026-11-02-one-database-design.md. Start HEAD a203642. Releases 1–3 live (0083–0088, control 0004).

## Pre-flight scan

| Pair / task | Produces → consumes | Finding |
|---|---|---|
| T1 → T2–T5, T11 | guard names / PENDING set → each task enables its guards | consistent |
| T2 → T3–T7 | guards read company_members; unbound = deny → all later DB tests | large test churn: tests must bind (actAsBound) — see Ruling 2 |
| T3 ↔ T6 | mirrors dropped ↔ app must not read old profile columns | consistent (T6 grep test) |
| T4 → T11 | per-company uniques added, globals kept → dropped in 0095 | consistent |
| T5 → T6, T7, T8 | session-company default (null without session) → service-role / fixture inserts need explicit company | see Ruling 2 |
| T5 ↔ T6 | console_add_first_admin lives in 0093 (T6) but allowlist in T5's DEFINER_ALLOWLIST | T6 adds its name to the shared constant |
| T8 | 0094 provision_company copies academy's catalogue | consistent |
| T10 → owner | rehearsal + runbook | rehearsal needs prod dump (exists, 2026-11-02; fine for rehearsal) |
| T11 self | 0095 must run with release 4 live | consistent; ships from a new branch |

Ruling 1: Release 4 = Tasks 1–10, shipped from branch `one-db-release-4` created at Task 10's head; Task 11 continues on `one-database` and ships as `one-db-release-5` — ship.sh reuses merged PRs for a reused branch name — cost if wrong: a branch rename.
Ruling 2: after the default switch (T5), rows inserted with no bound session get null company_id and fail (fail closed, as intended). DB test fixtures that run as postgres use a helper `asCompany(c, companyId)` (tests/db/helpers.ts) that sets request.jwt.claims to a fixture session bound to that company while staying postgres, so defaults resolve; E2E/API fixtures using the service role pass company_id explicitly. No fallback is added to app.current_company_id() — cost if wrong: test churn only.
Ruling 3: the window migrations are separate files (one transaction each); atomicity comes from suspending academy + restoring the pre-window dump on failure (plan header) — cost if wrong: a failed mid-window migration needs the restore path.

## Progress
Ruling 4: DEFINER_ALLOWLIST also holds public.branding_public / public.branding_logo until 0095 drops them (old pre-login readers, anon-callable) — cost if wrong: two extra allowlist lines removed in T11.
Ruling 5: company-id-index offender app.session_companies → Task 5 adds an index on it (not a narrowed guard); schema_migrations/pending_logins stay in rls-forced + tenant-definer-policies scope.
Task 1: complete (commits a203642..a903745, review clean; ⚠️ fail-today counts from a deleted probe — re-proven as each task enables its guard)
Task 1: minor (deferred → FOLD INTO TASK 5): non-skipped test that app.company_tables() is non-empty (>40); guard every company table has company_id; anchor COMPANY_CHECK with \bcompany_id
Task 1: minor (deferred): STAFF_GUARD heuristic; allowlists keyed by name (document key formats); PENDING size literal must reach 0 in T11; begin-atomic prosrc gap; indisvalid/partial indexes
Ruling 6: accepted — app.current_* helpers and guards rewritten as plpgsql (SQL-function inlining made recall_list 26 s); actAs binds to academy by default when no session_id is given; E2E apiAs binds — cost if wrong: helper semantics differ slightly from plan text.
Task 2: → FOLD INTO TASK 5: 24 column defaults still call auth.uid() (e.g. patients.created_by) → switch to app.current_user_id() and extend guard no-auth-outside-app to column defaults; self-row branches of profiles_select/user_permissions_select must end up company-limited by T5's restrictive policies.
Task 2: → FOLD INTO TASK 3: release-3 "unbound academy admin" tests now run bound — rewrite/remove with the fallback removal; unbound admin message is "Only admins can do this." (acceptable).
Task 2: complete (commits a903745..f6a9ed6, review clean; ⚠️ guard catalog coverage — guard green; set_user_permissions global write → Task 3 brief)
Task 2: → FOLD INTO TASK 3: assert single messages in one-db-member-writes.test.ts:84-85,187-188; CLAUDE.md Tests note: actAs binds to academy by default — pass session_id to test unbound paths
Task 2: minor (deferred): mfa_setup_done counts an mfa_reset event from any company (stricter, documented)
Ruling 7: accepted T3 additions so no SQL reads the old profile columns — protect_last_admin dropped (company_members' per-company trigger covers it), default_permissions moved to company_members, user_permissions PK (company_id,user_id,area), profiles_delegate_id_fkey → company_members_delegate_link, update(role,active,delegate_id) on profiles revoked, fit_component_v2 checks membership in the implant's company — cost if wrong: these are release-4-only (old app suspended); reviewer to verify each.
Task 3: known breakage until later tasks — console first-admin (T6) and isolation.spec dev2 (T7) create Auth users without a pending login; admin_user_history misses B profile rows until T5's audit_row company.
Task 3: review — 2 Important (admin_change_email shared-user refusal only in TS; fit_component_v2 organizer check untested); fix round 1 dispatched (FIX_BASE bc8a76f) incl. minors setPerms company-aware, fit_component staff-role, test-users guard
Task 3: ⚠️ resolved → fit_component_v2 id reads safe once T5 tenant_definer + T4 composite FKs; console companies.ts:57 counts profiles.active → T6 dispatch must name it; audit_row company for profiles rows → T5
Ruling 8: admin_set_name also refuses shared users in SQL (mirrors Ruling 11's TS rule) — cost if wrong: one check.
Task 3: fix round 1/5 (4 addressed, 0 open; commits bc8a76f..b20e6ef)
Task 3: complete (commits f6a9ed6..b20e6ef, review clean)
Task 3: minor (deferred): unbound branch of admin_company untested (no caller passes true now); scripts' pending row as organizer leaves orphan View rows for admin/delegate logins
Ruling 9: next_file_no must not reuse a number after a hard delete and must refuse with no bound company — use a per-company counter table app_private.file_no_counters (company_id pk → companies, last_no int) seeded in 0091 from the current max/sequence for academy, incremented under the row lock; keep patients_file_no_seq until 0095 — paper files must never share a number — cost if wrong: one small table.
Ruling 10: accepted — REPLACED_GLOBAL_UNIQUES (deleted in T11) and GLOBAL_UNIQUES (research_codes_code_key stays global); create_medical_history uses new.company_id; old branding readers read academy only.
Task 4: → FOLD INTO TASK 6: settings TS action .eq('id', true) → .eq('company_id', companyId) before 0095 drops id. → T5: non-id definer reads (save_template, attach_default, save_consent_version, current_consent_version) rely on T5 restrictive policies.
Task 4: → T5: app_private.file_no_counters needs a tenant_definer policy (loop covers every table in public+app_private)
Task 4: complete (commits b20e6ef..8077a68, review clean; ⚠️ composite-fks guard green per report; file_no_counters tenant_definer → T5)
Task 4: minor (deferred): file_no_counters audit trigger adds noise; E2E supervisor-booking/course-report/patient-stage-filter/delegate-portal → T10 full run; → T11 brief: drop global uniques BEFORE onboarding a second company
Ruling 11: accepted T5 additions — app.member_elsewhere and app.other_active_admin (postgres-owned helpers so shared-user refusals and last-admin checks see other companies under tenant_definer), stale-session cleanup moved into app.bind_session, execute on public functions for tenant_definer, default privileges, final ANALYZE; consequences accepted: delegates don't read the companies row, admins change profiles only via definers, profile audit rows per company of membership; postgres/service-role writes that fire tenant_definer triggers need a bound session (T6/T8 must handle) — cost if wrong: reviewer verifies each helper is minimal and allowlisted.
Task 5: perf note → T10 rehearsal: recall_list 4.3 s vs 3.1 s without policies (after ANALYZE; 9.4 s before) — measure on prod-sized dump; E2E implants/invite/statistics not yet run (memory) → run before completion.
Task 5: minor: scripts/spike-tenant-definer.ts no longer runs after 0092 (role exists) — mark as historical or delete in T10.
Task 5: review — 2 Important (pending_logins/file_no_counters lack company policies; schema_migrations open to tenant_definer); fix round 1 dispatched (FIX_BASE 5fc7327) with rolbypassrls check, create-user smoke, E2E implants/invite/statistics
Task 5: minor (deferred): allowlist matched by name (overloads); company_members_select own-row branch → PERSON_LEVEL_POLICIES; migrate.test commits a real function; admin_end_sessions not split (pre-existing); recall_list perf → T10
Task 5: fix round 1/5 (4 addressed, 0 open; commits 5fc7327..6c344d2)
Task 5: complete (commits 8077a68..6c344d2, review clean)
Ruling 12: console first-admin must cancel its pending admin row when createUser/invite fails (same rule as plan-2 Ruling 12) — add service-role-only public.console_cancel_pending_login(p_company uuid, p_email text) in 0093 (allowlisted) and call it on failure — a leftover admin-role pending row would enrol a later invite of that email as admin — cost if wrong: one function. Console E2E → T10 full run (dev2 needs 0093).
Task 6: review — 3 Important (ruling 12 cancel missing; tenant_definer can execute console_add_first_admin via 0092 default privileges; console resets the password of an account shared across companies); fix round 1 dispatched (FIX_BASE c4443cd)
Ruling 13: console first-admin for an account that already has a membership in another company — grant the admin membership + lift the ban, do NOT reset the password; new outcome "added — they sign in with their existing password" shown in the console (matches createLogin's rule) — cost if wrong: the owner hands that admin no one-time password.
Ruling 14: service-role-only functions (console_*) revoke execute from tenant_definer too, and a guard asserts no console_* / service-role-only function is executable by anon, authenticated or tenant_definer — 0092's default privileges grant tenant_definer execute on every new postgres-owned function — cost if wrong: none.
Task 6: minor (deferred): console_log records an added shared account as first_admin_created (no control migration for a new action)
Task 6: fix round 1/5 (4 addressed, 0 open; commits c4443cd..371b32a)
Task 6: complete (commits 6c344d2..371b32a, review clean)
Ruling 15: the two pinned cross-company gaps are FIXED, not pinned — new migration 0094_company_refs.sql: research_codes key becomes (company_id, entity, entity_id) and assign_research_codes / research_code refuse an entity_id that isn't the caller's company's row; create_pending_login refuses a p_delegate_id from another company ('Delegate not found.'); KNOWN_CROSS_REFERENCES must end empty. Later migrations shift: provision_company → 0095 (Task 8), cleanup → 0096 (Task 11) — a company must not be able to break another's study codes — cost if wrong: renumbering only.
Task 7: → T8: provision_company must seed settings (pages throw without it) — already in plan; → T10/T11 runbook: B login through B's own form failed under next dev (redirect fetched from localhost:3000 = academy host) — check sign-in on the canary's real host; reproduce under next start with real hostnames in T10 if possible.
Task 7: review — 3 Important (sweep counts any exception as pass; Focus 1 same, no positive control; returned-data check only matches names); fix round 1 dispatched with minors (auth/session checksums x::text + app.session_companies, uuid[] functions, move-row-into-A probe) (FIX_BASE 4df5aa9)
Ruling 16: ⚠️ RED evidence by dropping the restrictive policies inside the rolled-back transaction is accepted (the brief allowed it when an old-code run doesn't fit) — cost if wrong: none; the E2E admin-action test guards app-layer checks by design.
Task 7: fix round 1/5 (4 addressed, 0 open; commits 4df5aa9..d2fbdf0)
Task 7: complete (commits 371b32a..d2fbdf0, review clean)
Task 7: minor (deferred): Focus 1 accepts any 42501 as the guard refusal; control is aggregate 70%; probeTables select/update/delete treat any error as pass (row-count checked); random-uuid array defaults
Ruling 17: the five replaced global uniques (patients_file_no_key, patients_file_no_upper_key, chairs_name_key, consent_form_versions_label_key, checklist_templates_one_default) are dropped in release 4 (0095), not release 5 — the window suspends the previous app, the per-company uniques exist since 0091, and provisioning a second company needs them gone; REPLACED_GLOBAL_UNIQUES goes away now; Task 11's 0096 keeps only the column/reader/index drops — cost if wrong: none (backward-compatible drop).
Ruling 18: accepted control 0005 console_set_company(slug, id, actor) (audited, refuses repointing) and keeping the name provision_company with the service-role-only guard extended.
Task 8: console E2E 'adding a company' not run; its cleanup leaves the provisioned company on dev2 → T10
Task 8: review — 1 Important (console retry dead-ends when provision succeeded but the id wasn't saved); fix round 1 dispatched with minors 1–2 (FIX_BASE 7feb0ac)
Ruling 19: retry recovery — provision_company returns the existing company's id when the slug exists AND it has no members and no tenant row references it yet (checked by the caller); tenant:register --company writes through console_set_company(..., 'script'); control unique index on tenants.company_id (nulls allowed) — cost if wrong: a stale empty company could be adopted by the same slug, which is the intended recovery.
Ruling 20: accepted deviation — control unique index is (supabase_url, company_id) where company_id is not null, not company_id alone, because console:local maps two local stacks to academy's id; in prod (one project) it is still one tenant per company — cost if wrong: none.
Task 8: fix round 1/5 (3 addressed, 0 open; commits 7feb0ac..9a0ead0)
Task 8: complete (commits d2fbdf0..9a0ead0, review clean)
Task 8: minor (deferred): tenant supabase_url written two ways (case/trailing slash) defeats the index; seeded academy with no members would be "re-provisioned" by slug academy (harmless)
PAUSED 2026-11-03 by the owner after Task 8. Resume at Task 9 on "One DB resume".
RESUMED 2026-11-06 at Task 9 (BASE 9a0ead0).
Ruling 21: company-export/restore expose library functions taking a pg client (exportCompany(c, companyId), restoreCompany(c, companyId, data)) that run inside the caller's transaction; the CLIs wrap begin/commit, so the DB test runs them in withTx — cost if wrong: a thin wrapper refactor.
Ruling 22: restore deletes and reloads only company-scoped rows (company tables + that company's company_members); profiles and auth.users are upserted (insert … on conflict do nothing), never deleted, because a person can belong to another company; per-company deletion for a data-protection request (docs §D) removes the person rows only when they have no other membership — cost if wrong: a stale person row survives a restore.
Ruling 23: restore runs with `set local session_replication_role = replica` (skips audit_row, append-only and default-setting triggers so restored rows stay byte-identical and the ledger can be reloaded), and then re-checks FK integrity of the restored company with a query before commit — cost if wrong: a slower restore.
Task 9: dispatched (BASE 9a0ead0, implementer acaa81993f2424b18, sonnet)
Task 9: implementer DONE_WITH_CONCERNS a7effb3 (replica path untested — trigger-disable fallback used locally; backup needs company_id per tenant)
Task 9: review — 2 Important (set_config denied where SET LOCAL works → fallback always taken, auth/profiles triggers stay on; export not one snapshot → repeatable read); fix round 1 dispatched with minors (fingerprint B's profiles/auth.users, backup key guard, named no-company failure, refuse --delete+--in) (FIX_BASE a7effb3)
Task 9: minor (deferred): fallback lock path can deadlock with live app — doc it if kept
Task 9: fix round 1/5 (6 addressed, 0 open; commits a7effb3..3e9e277)
Task 9: complete (commits 9a0ead0..3e9e277, review clean)
Task 9: minor (deferred): backup.yml exit-3 (no company id) path untested on a runner; full npm test + test:db not re-run after fix round → T10 full run
Ruling 24: the window migrations are 0089–0095 (numbers shifted +1, Ruling 15; 0095 also drops the replaced global uniques, Ruling 17), so the rehearsals apply 0089–0095, not 0089–0094 — cost if wrong: none.
Ruling 25: window-checksums hashes each table over the columns present both before and after (company_id excluded); a table or column present on only one side fails the compare unless it is on an explicit EXPECTED_SCHEMA_CHANGES list in the script (each entry naming the migration that makes it), which the compare prints — the window intentionally adds tables/columns and drops profile mirrors — cost if wrong: a reviewer tightens the list.
Ruling 26: Task 10 also clears the deferred items aimed at it: full E2E incl. console 'adding a company' (T8) and the E2E specs named in T4/T6; recall_list timing on the restored prod-sized dump (T5); scripts/spike-tenant-definer.ts deleted (T5, historical, plan-1 notes keep the result); B sign-in under `next start` with real host names if practical, else a runbook step on the canary (T7) — cost if wrong: a longer task.
Task 10: dispatched (BASE 3e9e277)
Task 10: implementer a674409a21450cc6f (sonnet); lint fixes may go into unshipped 0089–0095 (small) rather than a new file
Task 10: implementer DONE_WITH_CONCERNS 92591ea, 77b00c5 (one-db-release-4 local at 77b00c5). Rehearsals PASS (window 5 s / 4 s). Concerns: recall_list 7.9 s via PostgREST on leftover-heavy local stack (visits E2E fails; 42 ms on restored dump — how measured?); research-export E2E fails on 1000-row delegate cap (pre-existing); console E2E 3/7 fail — console:local hybrid conflicts with 0090 on_auth_user_created; B sign-in under next start not tried (runbook canary check).
Ruling 27: the runbook lifts the suspension before the smoke test (a suspended company answers 503 to everyone, so there is no way to smoke-test behind it); the checksum compare and session-check run before the lift, and the rollback stays available after — cost if wrong: users may hit the app for minutes before the smoke test finishes.
Task 10: review — 3 Important (console E2E never run against a real company DB; session-check after the lift contradicts Ruling 27; visits E2E fails — recall_list 7.9 s at ~1150 patients, scaling unsettled); fix round 1 dispatched with minors 1–3 (column wording, auth refresh-timestamp note, control 0005 in runbook) (FIX_BASE 77b00c5)
Task 10: minor (deferred → backlog): exports page delegates select capped at PostgREST 1000 rows (pre-existing; research-export E2E fails on leftover data)
Task 10: fix round 1/5 (6 addressed, 0 open; commits 77b00c5..4a5c210)
Task 10: complete (commits 3e9e277..4a5c210, review clean; one-db-release-4 local at 4a5c210)
Task 10: minor (deferred → backlog): recall_list ~3 s at 796 implant patients (43% from 0092 policies), threshold ~400 implant patients in runbook; visits E2E fails on leftover-heavy stack; console-e2e company left in main local DB; 'adding a company' E2E registers a tenant without company id
Ruling 28: Task 11's migration is 0096_cleanup.sql (numbers shifted, Ruling 15) and does NOT drop the five replaced global uniques (already dropped in 0095, Ruling 17); it also drops patients_file_no_seq (kept "until cleanup", Ruling 9), removes branding_public/branding_logo from DEFINER_ALLOWLIST (Ruling 4) and brings the PENDING guard set to 0 (Task 1 minor); every drop must be unused by the release-4 app (grep proof in the report) because 0096 runs with release 4 live; the canary runbook states release 5 ships only after release 4's window is closed and verified, and carries the canary real-host sign-in check (Task 7/10); one-db-release-5 is created locally at Task 11's head — cost if wrong: a follow-up migration.
Task 11: dispatched (BASE 4a5c210)
Task 11: implementer DONE_WITH_CONCERNS ea828c8 (one-db-release-5 local). test:db 6 fail "leftover data" — but 5 of them come from extra companies on the main stack (console-e2e left by Task 10's console:local, catalogue copied by provision_company) → ship.sh verify would block; final 0096 (audit triggers added late) not dry-run end to end from 0095; admin_company p_academy_if_unbound left (runbook said T11).
Task 11: review — 1 Important (single-company test assumptions fail test:db on any machine that ran the console E2E: one-db-foundation, oxy-catalog, one-db-company-id, one-db-members); fix round 1 dispatched with minors (0096 end-to-end dry run from 0095, release-4-runbook p_academy_if_unbound line, canary-check DB/API project cross-check, row_id meaning comment) (FIX_BASE ea828c8)
Ruling 29: the single-company test fixes land as their own commit touching only tests that exist at 4a5c210, and are cherry-picked onto the local one-db-release-4 branch too, because release 4's ship.sh verify runs the same test:db — cost if wrong: one cherry-pick to undo.
Ruling 30: accepted deviation from Ruling 28 — branding_public/branding_logo stay in DEFINER_ALLOWLIST (with a comment) because migrate.ts checks each migration against it on a from-scratch database and 0092 still creates them; they're in no catalog after 0096 — cost if wrong: two stale allowlist lines.
Task 11: open → final review: one-db-release-4 (9cb1fff) fails one-db-company-id index test on a local stack already at 0096, so ship.sh verify for release 4 needs a local stack at 0095 (reset/rebuild before shipping release 4) — runbook must say so.
Task 11: fix round 1/5 (5 addressed, 0 open; commits ea828c8..f497363)
Task 11: complete (commits 4a5c210..f497363, review clean; one-db-release-5 local at f497363; tests cherry-picked to one-db-release-4 as 9cb1fff)
Task 11: minor (deferred): console E2E teardown catch{} swallows errors and lists 7 tables (company_members?) under replica; projectMismatch regex dots unescaped; canary-check live path untested until the canary exists
Final review (a203642..f497363): With fixes — 1 Critical (rollback via RESTORE.md loses grants, skips schema app, leaves tenant_definer so a retry fails at 0089's owner check; unproven), 2 Important (runbook must rebuild a stack at exactly 0095 before release-4 verify — 5 tests fail at 0096; operations §D per-company restore lacks suspend step and still describes the removed fallback), minors 4–11 + triage (projectMismatch regex, teardown catch logging before release 5).
Ruling 31: the final fix wave commits on one-database, and every commit touching a file that ships in release 4 (migrate.ts, release-4-runbook.md, operations.md, window-checksums.ts, backup.yml, company-export/restore, CLAUDE.md) is cherry-picked onto the local one-db-release-4 branch (conflicts resolved toward release-4 content); one-db-release-5 then moves to the one-database head — cost if wrong: branch surgery the owner can see in git log.
Ruling 32: the proven rollback lives in the repo (release-4-runbook.md Rollback, rehearsed on a local stack that ran 0089–0095); D:\Backups\...\RESTORE.md is outside the worktree and is not edited — the runbook says its whole-project section is superseded for release 4 — cost if wrong: the owner reads two documents.
Final fix wave: dispatched (FIX_BASE f497363, opus)
Final fix wave: DONE_WITH_CONCERNS one-database f497363..e5f9b2d; release-4 9cb1fff..5fcf6bc; rollback rehearsed locally (4.5 s), hosted untested
Final fix wave: re-review — all 12 findings ADDRESSED, no new Critical/Important.
Final: parked — release-4 runbook references release-5-canary.md, absent on one-db-release-4 — Ruling: harmless forward reference; surfaced to the owner as a pre-window doc touch-up.
Final: parked — runbook lacks "if the hosted rollback fails, re-promote the release-4 deployment (DB is still a consistent 0095)" — Ruling: real, surfaced to the owner before the window.
Final: parked — window-rollback.ts doesn't check the dump belongs to the target project — Ruling: real, cheap guard; surfaced to the owner before the window.
Final: parked (out of scope) — compare prod's fingerprint-before against a fresh local 0088 fingerprint before the window to catch hosted-only ACL differences — Ruling: surfaced as a recommended pre-window step.
