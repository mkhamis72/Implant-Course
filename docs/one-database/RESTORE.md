# Restore points for the one-database merge

Restore points taken before any change (Task 1, `web/scripts/pre-one-db-backup.ts`). Per project they hold:

| File | What it is |
|---|---|
| `full.dump` | `pg_dump --format=custom --no-owner --no-acl`, every schema including `auth` |
| `schema.dump` | the same, schema only |
| `counts.json` | exact row count of every table in `public`, `app_private` and `auth` |
| `settings.md` | host, server version, env and Vault secret names (no values) and blanks for the owner |

Layout: `<backup dir>/academy/` for the company, `<backup dir>/control/` for the control project. The git tag `pre-one-db-2026-11` marks the code.

Nothing here is run against production by a script. Every production step below is the owner's.

## Proof status

- Proven (2026-11-02) with a dump of the main local stack restored into a fresh second local stack (dev2) by `restore-check.ts`: `PASS 76/76`, including `auth.users`, `auth.identities`, `auth.mfa_factors` and the auth bookkeeping tables. No auth bookkeeping differences occurred in this run, but they are acceptable when a mismatch is limited to `auth.sessions`, `auth.refresh_tokens` and `auth.audit_log_entries` (they grow between the dump and the count). Any other mismatch is a failure.
- Proven (2026-11-02) with the real academy production dump (`pre-one-db/academy/full.dump`, 76 tables, 2198 rows) restored into a fresh dev2: `PASS 76/76`. The control dump (`pre-one-db/control/`) is taken but its restore is not proven.

## Check a dump (local only, any time)

Restores into a fresh local stack and compares counts. It refuses any host except 127.0.0.1 and empties the target's auth tables.

```bash
cd web
npm run db:dev2:stop                      # wipe: npx supabase stop --no-backup --workdir .dev2
npm run db:dev2:start                     # fresh stack, do NOT run db:migrate
ENV_FILE=.env.dev2 npx tsx scripts/restore-check.ts --dump <dir>/academy/full.dump --counts <dir>/academy/counts.json
npm run db:dev2:stop
```

Exit code 1 and one `MISMATCH` line per table on failure; `PASS n/n` on success. `db:dev2:stop` keeps the stack's data, so for a really fresh stack stop it with `npx supabase stop --no-backup --workdir .dev2` first. Docker Desktop must be running; about 3 GB of free memory is needed, so stop the main stack (`npm run db:stop`) while dev2 runs and restart it after (`npm run db:start`).

What the check does, in this order (the order matters):

1. Empties the target's `auth` tables (except `auth.schema_migrations`, which belongs to the auth service; the stack already filled it).
2. `pg_restore --no-owner --no-acl --data-only --schema=auth`, with `auth.users` and `auth.sessions` first (without `--disable-triggers`, which the `postgres` role may not use on auth tables, there is no foreign-key ordering).
3. Creates `app_private`, then `pg_restore --no-owner --no-acl --schema=public --schema=app_private`. Auth data must already be there, because `public` tables have foreign keys to `auth.users`.
4. Counts every table and compares with `counts.json`.

## Restore the whole academy project

> **NOT proven on a hosted project.** The local fresh-stack flow in "Check a dump" is the only verified path. The commands below follow its order but have never been run against a hosted Supabase project (ownership limits, `--clean` on live data, TLS). Re-check the real academy dump with `restore-check` before anyone relies on this.

Run only when the data is damaged and the owner decides to go back to the restore point. Data written after the dump is lost.

1. Suspend the company in the console so nobody writes during the restore.
2. Get the project's Session pooler URI (Supabase dashboard, Connect). Put it in `PGURL` and keep it out of the shell history; from a docker container use `-e PGURL`, never the URL on the command line. On Windows Git Bash set `MSYS_NO_PATHCONV=1`. A hosted project needs TLS: add `-e PGSSLMODE=verify-full -e PGSSLROOTCERT=/ca.crt -v "<path to ca.crt>:/ca.crt:ro"` to every `docker run`.
3. Auth first (the `public` tables have foreign keys to `auth.users`). Empty the project's auth tables except `auth.schema_migrations` (not truncatable, kept as is), then restore the data with `auth.users` and `auth.sessions` first, using a `-L` list. There is no `--disable-triggers`, because the role does not own the auth tables:

```bash
docker run --rm -e PGURL -v "<backup dir>/academy:/in:ro" postgres:17 sh -c '
  { pg_restore -l /in/full.dump | grep " TABLE DATA auth users ";
    pg_restore -l /in/full.dump | grep " TABLE DATA auth sessions ";
    pg_restore -l /in/full.dump | grep -v -e " auth schema_migrations " -e " TABLE DATA auth users " -e " TABLE DATA auth sessions "; } > /tmp/list
  pg_restore --dbname="$PGURL" --no-owner --no-acl --data-only --schema=auth -L /tmp/list /in/full.dump'
```

   The truncate itself is run with psql or any client as the project's `postgres` role: `truncate <every auth table except schema_migrations> cascade` (the list comes from `pg_class` in schema `auth`, as `restore-check.ts` does).
4. Create the schema (a `--schema` filter does not carry it), then the app schemas:

```bash
docker run --rm -e PGURL postgres:17 psql "$PGURL" -c 'create schema if not exists app_private'
docker run --rm -e PGURL -v "<backup dir>/academy:/in:ro" postgres:17 sh -c '
  pg_restore --dbname="$PGURL" --clean --if-exists --no-owner --no-acl --schema=public --schema=app_private /in/full.dump'
```

   Steps 3 and 4 are in that order on purpose. Of these, only the order, the truncate, the `-L` list and `create schema` are proven (locally); `--clean --if-exists` is not.
5. Check counts: take the counts of the restored project with the same query (`countsSql()` in `web/scripts/pre-one-db-backup-lib.ts`) and compare with `counts.json`. Only auth bookkeeping may differ (see Proof status).
6. Lift the suspension in the console and sign in to confirm.

## Restore the control project

> **NOT proven on a hosted project, and not proven at all for the control project.** The local check was run only on the app database. The creation of `control_private` and the restore order for the control dump are untested; the local fresh-stack flow in "Check a dump" is the only verified path. Test it on a dump of the control project in a local stack first.

The same steps as above, in the same order (auth, then create the schema, then the app schemas), with `control_private` instead of `app_private` (`create schema if not exists control_private`, `--schema=public --schema=control_private`), using `<backup dir>/control/full.dump` and `control/counts.json`. The company registry and the Vault secrets live there: after restoring, run `npm run tenant:check -- academy` (`ENV_FILE=.env.prod`) to confirm the company still resolves. Vault secret values are not in `settings.md`; if Vault was lost, re-register the company with `npm run tenant:register`.

## Restore the code

```bash
git checkout pre-one-db-2026-11
```

then redeploy through Release (the owner's `./scripts/ship.sh ship` flow). Release migrates production before deploying, so a database restored to the restore point and code at the tag agree. Never deploy the tag against a database that has had later migrations applied.

## Settings copies

`settings.md` in each project folder records the Supabase settings that are not in the database. The owner fills in the blanks (auth providers, redirect URLs, email templates, plan and backup / PITR status, latest backup time) from the dashboard before the merge starts. Keep these copies with the dumps, not in git.
