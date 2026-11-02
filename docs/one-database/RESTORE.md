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
- **Pending:** the same proof with the real academy dump. The owner's production dump does not exist yet; re-run the check below on it when it does.

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

Run only when the data is damaged and the owner decides to go back to the restore point. Data written after the dump is lost.

1. Suspend the company in the console so nobody writes during the restore.
2. Get the project's Session pooler URI (Supabase dashboard, Connect). Put it in `PGURL` and keep it out of the shell history; from a docker container use `-e PGURL`, never the URL on the command line.
3. Restore, from the folder holding the dump:

```bash
docker run --rm -e PGURL -v "<backup dir>/academy:/in:ro" postgres:17 sh -c '
  pg_restore --dbname="$PGURL" --clean --if-exists --no-owner --no-acl --schema=public --schema=app_private /in/full.dump &&
  pg_restore --dbname="$PGURL" --data-only --no-owner --no-acl --schema=auth /in/full.dump'
```

   On Windows Git Bash set `MSYS_NO_PATHCONV=1` first. A hosted project needs TLS: add `-e PGSSLMODE=verify-full -e PGSSLROOTCERT=/ca.crt -v "<path to ca.crt>:/ca.crt:ro"`.
4. The auth restore is data only, so empty the project's auth tables (the ones the role may truncate) before it, or it fails on duplicate keys. Load `auth.users` before `auth.sessions` (see "Check a dump", step 2). Restore auth before the app schemas when the app schemas have to be recreated, because of the foreign keys to `auth.users`.
5. Check counts: take the counts of the restored project with the same query (`countsSql()` in `web/scripts/pre-one-db-backup-lib.ts`) and compare with `counts.json`. Only auth bookkeeping may differ (see Proof status).
6. Lift the suspension in the console and sign in to confirm.

## Restore the control project

The same as above, with `--schema=public --schema=control_private` instead of `--schema=public --schema=app_private`, using `<backup dir>/control/full.dump` and `control/counts.json`. The company registry and the Vault secrets live there: after restoring, run `npm run tenant:check -- academy` (`ENV_FILE=.env.prod`) to confirm the company still resolves. Vault secret values are not in `settings.md`; if Vault was lost, re-register the company with `npm run tenant:register`.

## Restore the code

```bash
git checkout pre-one-db-2026-11
```

then redeploy through Release (the owner's `./scripts/ship.sh ship` flow). Release migrates production before deploying, so a database restored to the restore point and code at the tag agree. Never deploy the tag against a database that has had later migrations applied.

## Settings copies

`settings.md` in each project folder records the Supabase settings that are not in the database. The owner fills in the blanks (auth providers, redirect URLs, email templates, plan and backup / PITR status, latest backup time) from the dashboard before the merge starts. Keep these copies with the dumps, not in git.
