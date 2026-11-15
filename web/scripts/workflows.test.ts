// Pins the safety properties of the release and backup workflows (production is changed only by these).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

type Step = { id?: string; name?: string; if?: string; env?: Record<string, string>; run?: string; uses?: string; with?: Record<string, unknown> };
type Job = { if?: string; needs?: string; steps: Step[] };
const load = (file: string) =>
  parse(readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', file), 'utf8')) as { jobs: Record<string, Job> };
const runOf = (job: Job, name: string) => job.steps.find((s) => s.name?.startsWith(name))?.run ?? '';

describe('release.yml', () => {
  const { jobs } = load('release.yml');
  const deploy = jobs['migrate-and-deploy'];

  it('builds the app before anything touches production', () => {
    expect(jobs.check.steps.map((s) => s.run)).toContain('npm run build');
    expect(deploy.needs).toBe('check');
  });
  it('migrates and deploys only from master', () => {
    expect(deploy.if).toBe("github.ref == 'refs/heads/master'");
  });
  it('deploys only if master still points at the commit it migrated', () => {
    const run = runOf(deploy, 'Deploy');
    expect(run).toContain('git ls-remote origin refs/heads/master');
    expect(run).toContain('$GITHUB_SHA');
    const names = deploy.steps.map((s) => s.name ?? '');
    expect(names.findIndex((n) => n.startsWith('Migrate'))).toBeLessThan(names.findIndex((n) => n.startsWith('Deploy')));
  });
  it('migrates the one production database (PROD_DATABASE_URL), then deploys (release 3 of the merge)', () => {
    const run = runOf(deploy, 'Migrate');
    const migrate = run.indexOf('npm run db:migrate');
    expect(migrate).toBeGreaterThan(-1);
    expect(run).not.toMatch(/--control|--all-tenants|--tenant/);
    expect(run.indexOf('PROD_DATABASE_URL secret is missing')).toBeLessThan(migrate);
    expect(run).toContain('set -euo pipefail');
    expect(run.split('\n').find((l) => l.includes('export '))).toContain('DATABASE_URL="$PROD_DATABASE_URL" DATABASE_CA_CERT="$RUNNER_TEMP/prod-ca.crt"');
  });
  it('nothing in either workflow reads the control project any more', () => {
    for (const file of ['release.yml', 'backup.yml']) {
      const text = readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', file), 'utf8');
      expect(text).not.toMatch(/CONTROL_|tenants:export|_control-|--tenant/);
    }
  });
  // Merge of control into production, release 2: once COMPANY_LIST=production is set the console writes to
  // production, and a copy from control would overwrite those changes with control's stale list.
  it('Release no longer copies the company list (release 2 of the merge)', () => {
    expect(deploy.steps.some((s) => (s.name ?? '').startsWith('Copy the company list'))).toBe(false);
    expect(deploy.steps.some((s) => /list:(copy|compare)/.test(s.run ?? ''))).toBe(false);
  });
  it('release_backs_up_before_migrating', () => {
    const names = deploy.steps.map((s) => s.name ?? '');
    const at = (prefix: string) => names.findIndex((n) => n.startsWith(prefix));
    const backup = deploy.steps.find((s) => s.name?.startsWith('Back up'));
    const offsite = deploy.steps.find((s) => s.name?.startsWith('Copy the pre-release backup'));
    const artifact = deploy.steps.findIndex((s) => s.uses?.startsWith('actions/upload-artifact'));
    // Export, dump, artifact and off-site copy all come before the migration; none may be skipped or soft-failed.
    expect(at('Install the newest PostgreSQL client')).toBeGreaterThan(-1);
    expect(at('Export the companies')).toBe(-1);
    expect(at('Back up')).toBeGreaterThan(at('Install the newest PostgreSQL client'));
    expect(artifact).toBeGreaterThan(at('Back up'));
    expect(at('Copy the pre-release backup')).toBeGreaterThan(artifact);
    expect(at('Migrate')).toBeGreaterThan(at('Copy the pre-release backup'));
    for (const s of deploy.steps.slice(0, at('Migrate'))) {
      expect(s).not.toHaveProperty('continue-on-error');
      expect(s).not.toHaveProperty('if');
    }
    const run = backup?.run ?? '';
    expect(run).toContain('set -euo pipefail');
    expect(run).toContain('BACKUP_PASSPHRASE secret is missing');
    expect(run.indexOf('BACKUP_PASSPHRASE secret is missing')).toBeLessThan(run.indexOf('pg_dump'));
    expect(run).toMatch(/encrypt\(\) \{ gpg [^}]*--symmetric --cipher-algo AES256/);
    expect(run).not.toMatch(/pg_dump[^\n]*> /);
    expect(run.indexOf('PROD_DATABASE_URL secret is missing')).toBeLessThan(run.indexOf('pg_dump'));
    // Schema and data (no --data-only): a restore point for the exact state before the migration.
    expect(run).not.toContain('--data-only');
    // The one database, whole: every company, the console and both sign-in schemas.
    const whole = run.slice(run.indexOf('pg_dump'), run.indexOf('out/prod-$day.dump.gpg'));
    expect(whole).not.toBe('');
    for (const schema of ['public', 'app_private', 'app', 'auth', 'self_auth']) expect(whole).toContain(`--schema=${schema} `);
    expect(whole).toContain('"$PROD_DATABASE_URL"');
    expect(run.match(/pg_dump/g)?.length).toBe(1);
    // Nothing soft-fails inside the step: no per-company failure list, a failed dump stops the job.
    expect(run).not.toContain('failed+=');
    for (const n of ['PASSPHRASE', 'PROD_DATABASE_URL', 'CA']) expect(cleans(run, n)).toBe(true);
    // Uploaded as an artifact and to R2 under a per-attempt prefix (locked files cannot be overwritten on a re-run).
    expect(deploy.steps[artifact].with).toMatchObject({
      name: 'pre-release-backups-${{ github.run_id }}-${{ github.run_attempt }}', path: 'web/out/*.dump.gpg', 'if-no-files-found': 'error',
    });
    const copy = offsite?.run ?? '';
    expect(offsite?.env?.RUN_ID).toBe('${{ github.run_id }}-${{ github.run_attempt }}');
    expect(copy).toContain('prefix="$(date -u +%F)/$RUN_ID"');
    expect(copy).toContain("--exclude '*' --include '*.dump.gpg'");
    expect(copy).toContain('R2 secrets are missing');
    for (const n of ['R2_ENDPOINT', 'R2_BUCKET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']) expect(cleans(copy, n)).toBe(true);
  });
  it('migrates every file: no migration is held (Migration B, 0103, is applied everywhere since 2026-11-12)', () => {
    const step = deploy.steps.find((s) => s.name?.startsWith('Migrate'));
    expect(step?.env).toBeDefined();
    expect(Object.keys(step?.env ?? {}).filter((k) => /HOLD/.test(k))).toEqual([]);
  });
  it('builds every deploy without Vercel build cache (the vendored self-auth tarball has no lockfile integrity)', () => {
    const run = runOf(deploy, 'Deploy');
    expect(run).toContain('curl --fail --silent --show-error -X POST "$HOOK?buildCache=false"');
    expect(run).not.toMatch(/-X POST "\$HOOK"/);
  });
  it('deploys unconditionally after the migration step (no step-level if)', () => {
    const step = deploy.steps.find((s) => s.name?.startsWith('Deploy'));
    expect(step).toBeDefined();
    expect(step).not.toHaveProperty('if');
  });
});

// Secrets pasted on Windows can carry a trailing CR/LF; every step strips it before use
// (a CR in the hook URL breaks curl; in the passphrase it would silently change the key).
const CLEAN = `clean() { printf '%s' "$1" | tr -d '\\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }`;
const cleans = (run: string, name: string) => run.includes(CLEAN) && run.includes(`${name}="$(clean "$${name}")"`);

describe('secrets are cleaned of stray line endings before use', () => {
  const release = load('release.yml').jobs['migrate-and-deploy'];
  const backup = load('backup.yml').jobs;
  it('release: production database URL, CA certificate and deploy hook', () => {
    expect(cleans(runOf(release, 'Migrate'), 'PROD_DATABASE_URL')).toBe(true);
    expect(cleans(runOf(release, 'Migrate'), 'PROD_DATABASE_CA_CERT')).toBe(true);
    expect(cleans(runOf(release, 'Deploy'), 'HOOK')).toBe(true);
  });
  it('backup and verify: passphrase, production database URL, CA certificate and keep-awake keys', () => {
    const dump = runOf(backup.backup, 'Dump');
    for (const n of ['PASSPHRASE', 'PROD_DATABASE_URL', 'CA']) expect(cleans(dump, n)).toBe(true);
    for (const n of ['PROD_SUPABASE_URL', 'PROD_ANON_KEY']) expect(cleans(runOf(backup.backup, 'Keep'), n)).toBe(true);
    expect(cleans(runOf(backup.verify, 'Decrypt'), 'PASSPHRASE')).toBe(true);
  });
  it('backup and verify: the off-site (R2) endpoint, bucket and keys', () => {
    for (const step of [runOf(backup.backup, 'Copy'), runOf(backup.verify, 'Download the latest off-site')])
      for (const n of ['R2_ENDPOINT', 'R2_BUCKET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']) expect(cleans(step, n)).toBe(true);
  });
});

describe('backup.yml', () => {
  const { jobs } = load('backup.yml');
  const dump = runOf(jobs.backup, 'Dump');

  it('refuses to run without the passphrase or the database, before dumping anything', () => {
    for (const m of ['BACKUP_PASSPHRASE secret is missing', 'PROD_DATABASE_URL secret is missing', 'PROD_DATABASE_CA_CERT secret is missing']) {
      expect(dump.indexOf(m)).toBeGreaterThan(-1);
      expect(dump.indexOf(m)).toBeLessThan(dump.indexOf('pg_dump'));
    }
  });
  it('dumps the data a restore needs for each company: app tables and sign-in accounts, without migration bookkeeping', () => {
    expect(dump).toContain('--data-only');
    expect(dump).toContain('--schema=auth');
    expect(dump).toContain('--exclude-table=app_private.schema_migrations');
    expect(dump).toContain('--exclude-table=auth.schema_migrations');
    expect(dump).toContain('out/prod-$day.dump.gpg');
  });
  it('encrypts every dump on the way out (the plain dump never touches disk)', () => {
    expect(dump).toMatch(/encrypt\(\) \{ gpg [^}]*--symmetric --cipher-algo AES256/);
    expect(dump.match(/\| encrypt /g)?.length).toBe(2); // whole database, company export
    expect(dump).not.toMatch(/pg_dump[^\n]*> /);
  });
  it('dumps the one database once, then exports each company listed in it on its own', () => {
    expect(dump.match(/pg_dump/g)?.length).toBe(1);
    expect(dump).toContain('"$PROD_DATABASE_URL"');
    expect(dump).toContain('npm run --silent companies:list');
    expect(dump.indexOf('pg_dump')).toBeLessThan(dump.indexOf('companies:list'));
    expect(dump).toContain('npm run --silent company:export -- --company "$slug" --out -');
    expect(dump).toContain('out/$slug-$day.company.dump.gpg');
    expect(dump).toContain('failed+=("$slug (company export)")');
  });
  it('verify mode reads each company export too', () => {
    const verify = runOf(jobs.verify, 'Decrypt');
    expect(verify).toContain('*.company.dump.gpg');
    // v2 (since 2026-11-16) carries the company row and its sign-in accounts; a v1 set (older) is still read.
    expect(verify).toContain('d.format === "company-export-v2" ? (d.company && typeof d.company === "object" && Array.isArray(t["self_auth.user"]))');
    expect(verify).toContain(': (d.format === "company-export-v1" && Array.isArray(t["auth.users"]))');
  });
  it('verify mode parses each company export as JSON (a truncated file fails), not by grepping for strings', () => {
    const verify = runOf(jobs.verify, 'Decrypt');
    expect(verify).toContain('JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))');
    expect(verify).toContain('!Number.isNaN(Date.parse(d.exported_at))');
    expect(verify).toContain('Array.isArray(t["public.patients"])');
    expect(verify).toContain('! info=$(node -e "$CHECK_EXPORT" "$RUNNER_TEMP/check.dump")');
    expect(verify).not.toContain('grep -q \'"format":"company-export-v1"\'');
  });
  it('backs up every listed company; an empty list fails the run but the whole dump is still uploaded (review)', () => {
    expect(dump).toContain('No companies were listed');
    expect(dump).toContain('failed+=("company list")');
    const empty = dump.slice(dump.indexOf('No companies were listed') - 120, dump.indexOf('No companies were listed') + 80);
    expect(empty).not.toContain('exit 1');
    expect(jobs.backup.steps.some((s) => s.name?.startsWith('Export'))).toBe(false);
  });
  it('keeps going past a failed company but fails the run at the end, naming it', () => {
    expect(dump).toContain('failed+=');
    expect(runOf(jobs.backup, 'Fail')).toContain('exit 1');
  });
  it('keep-awake records failures and continues; the final step runs even after a failure and reports both lists', () => {
    expect(runOf(jobs.backup, 'Keep')).toContain('woke_failed+=');
    expect(runOf(jobs.backup, 'Keep')).toContain('keepawake-failed.txt');
    const fail = jobs.backup.steps.find((s) => s.name?.startsWith('Fail'));
    expect(fail?.if).toBe('${{ !cancelled() }}');
    expect(fail?.run).toContain('keepawake-failed.txt');
    expect(fail?.run).toContain('Keep-awake failed for');
  });
  it('the final step fails the run when the dump step did not succeed, before reporting success', () => {
    expect(jobs.backup.steps.map((s) => s.id)).toContain('dump');
    const fail = jobs.backup.steps.find((s) => s.name?.startsWith('Fail'));
    expect(fail?.env?.DUMP_OUTCOME).toContain('steps.dump.outcome');
    expect(fail?.run).toContain('Backup did not run');
    expect(fail!.run!.indexOf('Backup did not run')).toBeLessThan(fail!.run!.indexOf('were backed up'));
  });
  it('keep-awake checks its secrets and records, not exits, when they are missing', () => {
    const keep = runOf(jobs.backup, 'Keep');
    expect(keep).toContain('production (secrets missing)');
    expect(keep.indexOf('secrets are missing')).toBeLessThan(keep.indexOf('curl'));
    expect(keep).not.toContain('exit 1');
  });
  it('keeps the sign-in accounts of both systems in the whole-database dump', () => {
    expect(dump).toContain('--schema=auth --schema=self_auth');
  });
  it('uploads one artifact per night', () => {
    const upload = jobs.backup.steps.find((s) => s.uses?.startsWith('actions/upload-artifact'));
    expect(upload?.with).toMatchObject({ name: 'backups-${{ github.run_id }}', path: 'web/out/*.dump.gpg', 'retention-days': 14 });
  });
  it('uses the newest PostgreSQL client, never a pinned older one', () => {
    for (const job of Object.values(jobs)) expect(JSON.stringify(job)).not.toContain('postgresql/17');
  });
  it('keeps the production project awake with an endpoint the anon key may call', () => {
    const keep = runOf(jobs.backup, 'Keep');
    expect(keep).toContain('"$PROD_SUPABASE_URL/auth/v1/health"');
    expect(keep).toContain('apikey: $PROD_ANON_KEY');
  });
  it('verify mode checks every file: the whole dump has patients, sign-in accounts and companies; each company has its export', () => {
    const verify = runOf(jobs.verify, 'Decrypt');
    expect(verify).toContain('TABLE DATA public patients');
    expect(verify).toContain('TABLE DATA auth users');
    expect(verify).toContain('TABLE DATA self_auth user');
    expect(verify).toContain('TABLE DATA public companies');
    expect(verify).not.toContain('_control-');
    expect(verify).toContain('whole-database file missing');
    expect(verify).toContain('no company exports');
    expect(verify).toContain('for f in "$dir"/*.dump.gpg');
    expect(runOf(jobs.verify, 'Download the latest backup')).toContain('startswith("backups-")');
    expect(verify).toContain('Backup problem');
  });
  it('verify names every company of the whole dump whose own export is missing (review)', () => {
    const verify = runOf(jobs.verify, 'Decrypt');
    // The companies come from the whole dump itself (verify has no database): its public.companies rows.
    expect(verify).toContain('pg_restore" --data-only --table=companies -f -');
    expect(verify).toContain('company export missing');
    expect(verify).toMatch(/for slug in \$slugs; do/);
    expect(verify).toContain('$slug-*.company.dump.gpg');
  });

  it('backs up nightly and verifies on its own on the 1st of each month, never both from one schedule', () => {
    const { on } = parse(readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'backup.yml'), 'utf8')) as {
      on: { schedule: { cron: string }[] };
    };
    expect(on.schedule.map((s) => s.cron)).toEqual(['0 0 * * *', '0 6 1 * *']);
    expect(jobs.backup.if).toBe("github.event.schedule == '0 0 * * *' || inputs.mode == 'backup'");
    expect(jobs.verify.if).toBe("github.event.schedule == '0 6 1 * *' || inputs.mode == 'verify'");
  });

  describe('off-site copy (Cloudflare R2)', () => {
    const copyStep = jobs.backup.steps.find((s) => s.name?.startsWith('Copy'));
    const copy = copyStep?.run ?? '';
    const names = jobs.backup.steps.map((s) => s.name ?? '');
    const fail = jobs.backup.steps.find((s) => s.name?.startsWith('Fail'));

    it('copies only the encrypted files, after the artifact and before keep-awake', () => {
      expect(copy).toContain("--exclude '*' --include '*.dump.gpg'");
      expect(copy).toContain('aws s3 cp out/');
      const artifact = jobs.backup.steps.findIndex((s) => s.uses?.startsWith('actions/upload-artifact'));
      expect(artifact).toBeLessThan(names.findIndex((n) => n.startsWith('Copy')));
      expect(names.findIndex((n) => n.startsWith('Copy'))).toBeLessThan(names.findIndex((n) => n.startsWith('Keep')));
    });
    it('stores each run under its own date and run id (locked files cannot be overwritten)', () => {
      expect(copyStep?.env?.RUN_ID).toBe('${{ github.run_id }}');
      expect(copy).toContain('prefix="$(date -u +%F)/$RUN_ID"');
      expect(copy).toContain('s3://$R2_BUCKET/$prefix/');
    });
    it('a failed or unconfigured copy still lets keep-awake run, then fails the run by name', () => {
      expect(copyStep).toMatchObject({ id: 'offsite', 'continue-on-error': true });
      expect(copy).toContain('R2 secrets are missing');
      expect(copy.indexOf('R2 secrets are missing')).toBeLessThan(copy.indexOf('aws s3'));
      expect(fail?.env?.OFFSITE_OUTCOME).toContain('steps.offsite.outcome');
      expect(fail?.run).toContain('Off-site copy failed');
      expect(fail!.run!.indexOf('Off-site copy failed')).toBeLessThan(fail!.run!.indexOf('were backed up'));
    });
    it('verify checks the newest off-site set as well as the artifact', () => {
      const download = runOf(jobs.verify, 'Download the latest off-site');
      expect(download).toContain('aws s3 cp "s3://$R2_BUCKET/$prefix/" offsite/ --recursive');
      // Only a nightly set (<date>/<run id>/), never a pre-release one (<date>/<run id>-<attempt>/), which has no exports.
      expect(download).toContain("grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9]+/'");
      expect(runOf(jobs.verify, 'Decrypt')).toContain('for dir in in offsite');
    });
  });
});

describe('error-alert.yml', () => {
  const file = path.join(__dirname, '..', '..', '.github', 'workflows', 'error-alert.yml');
  const wf = parse(readFileSync(file, 'utf8')) as { on: { schedule: { cron: string }[]; workflow_dispatch?: unknown }; jobs: Record<string, Job & { environment?: string }> };
  const job = wf.jobs.check;
  const run = runOf(job, 'Check');

  it('runs every hour, and by hand, in the production environment', () => {
    expect(wf.on.schedule.map((s) => s.cron)).toEqual(['17 * * * *']);
    expect(wf.on).toHaveProperty('workflow_dispatch');
    expect(job.environment).toBe('production');
  });
  it('cleans its secrets and stops, naming them, before connecting', () => {
    for (const n of ['PROD_DATABASE_URL', 'PROD_DATABASE_CA_CERT']) expect(cleans(run, n)).toBe(true);
    expect(run.indexOf('PROD_DATABASE_URL secret is missing')).toBeLessThan(run.indexOf('error-alert.ts'));
    expect(run).toContain('set -euo pipefail');
  });
  it('runs the check against production with verified TLS; its failure is the alert (no soft-fail)', () => {
    expect(run).toContain('DATABASE_URL="$PROD_DATABASE_URL" DATABASE_CA_CERT="$RUNNER_TEMP/prod-ca.crt" CONSOLE_HOST=console.imploid.net npx tsx scripts/error-alert.ts');
    const step = job.steps.find((s) => s.name?.startsWith('Check'));
    expect(step).not.toHaveProperty('continue-on-error');
    expect(step?.if).toBeUndefined();
  });
});
