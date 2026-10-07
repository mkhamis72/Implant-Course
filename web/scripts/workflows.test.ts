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
  it('migrates the control project, then every company, then deploys', () => {
    const run = runOf(deploy, 'Migrate');
    const control = run.indexOf('npm run db:migrate -- --control');
    const all = run.indexOf('npm run db:migrate -- --all-tenants');
    expect(control).toBeGreaterThan(-1);
    expect(all).toBeGreaterThan(control);
    expect(run).not.toContain('PROD_DATABASE_URL');
    expect(run.indexOf('CONTROL_DATABASE_URL secret is missing')).toBeLessThan(control);
    expect(run).toContain('set -euo pipefail');
    expect(run).toContain('DATABASE_CA_CERT="$RUNNER_TEMP/prod-ca.crt"');
    expect(run.split('\n').find((l) => l.includes('export '))).toContain('DATABASE_CA_CERT="$RUNNER_TEMP/prod-ca.crt"');
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
  it('release: control database URL, CA certificate and deploy hook', () => {
    expect(cleans(runOf(release, 'Migrate'), 'CONTROL_DATABASE_URL')).toBe(true);
    expect(cleans(runOf(release, 'Migrate'), 'PROD_DATABASE_CA_CERT')).toBe(true);
    expect(cleans(runOf(release, 'Deploy'), 'HOOK')).toBe(true);
  });
  it('backup and verify: passphrase, control database URL, CA certificate and control keep-awake keys', () => {
    const dump = runOf(backup.backup, 'Dump');
    for (const n of ['PASSPHRASE', 'CONTROL_DATABASE_URL', 'CA']) expect(cleans(dump, n)).toBe(true);
    for (const n of ['CONTROL_DATABASE_URL', 'CA']) expect(cleans(runOf(backup.backup, 'Export'), n)).toBe(true);
    for (const n of ['CONTROL_SUPABASE_URL', 'CONTROL_ANON_KEY']) expect(cleans(runOf(backup.backup, 'Keep'), n)).toBe(true);
    expect(cleans(runOf(backup.verify, 'Decrypt'), 'PASSPHRASE')).toBe(true);
  });
});

describe('backup.yml', () => {
  const { jobs } = load('backup.yml');
  const dump = runOf(jobs.backup, 'Dump');

  it('refuses to run without the passphrase, before dumping anything', () => {
    expect(dump.indexOf('BACKUP_PASSPHRASE secret is missing')).toBeGreaterThan(-1);
    expect(dump.indexOf('BACKUP_PASSPHRASE secret is missing')).toBeLessThan(dump.indexOf('pg_dump'));
  });
  it('dumps the data a restore needs for each company: app tables and sign-in accounts, without migration bookkeeping', () => {
    expect(dump).toContain('--data-only');
    expect(dump).toContain('--schema=auth');
    expect(dump).toContain('--exclude-table=app_private.schema_migrations');
    expect(dump).toContain('--exclude-table=auth.schema_migrations');
    expect(dump).toContain('out/$SLUG-$day.dump.gpg');
  });
  it('encrypts every dump on the way out (the plain dump never touches disk)', () => {
    expect(dump).toMatch(/encrypt\(\) \{ gpg [^}]*--symmetric --cipher-algo AES256/);
    expect(dump.match(/\| encrypt /g)?.length).toBe(2);
    expect(dump).not.toMatch(/pg_dump[^\n]*> /);
  });
  it('backs up every exported company, refusing an empty export', () => {
    expect(runOf(jobs.backup, 'Export')).toContain('npm run tenants:export -- --dir "$RUNNER_TEMP/tenants"');
    expect(dump).toContain('No companies were exported');
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
  it('the final step fails the run when the export or dump step did not succeed, before reporting success', () => {
    const ids = jobs.backup.steps.map((s) => s.id);
    expect(ids).toContain('export');
    expect(ids).toContain('dump');
    const fail = jobs.backup.steps.find((s) => s.name?.startsWith('Fail'));
    expect(fail?.env?.EXPORT_OUTCOME).toContain('steps.export.outcome');
    expect(fail?.env?.DUMP_OUTCOME).toContain('steps.dump.outcome');
    expect(fail?.run).toContain('Backup did not run');
    expect(fail!.run!.indexOf('Backup did not run')).toBeLessThan(fail!.run!.indexOf('were backed up'));
  });
  it('keep-awake checks the control secrets before the loop and records, not exits, when they are missing', () => {
    const keep = runOf(jobs.backup, 'Keep');
    expect(keep).toContain('control (secrets missing)');
    expect(keep.indexOf('secrets are missing')).toBeLessThan(keep.indexOf('for f in'));
    expect(keep).not.toContain('exit 1');
  });
  it('backs up only the registry from the control project', () => {
    expect(dump).toContain('--table=public.tenants --table=public.tenant_audit');
    expect(dump).toContain('out/_control-$day.dump.gpg');
  });
  it('uploads one artifact per night', () => {
    const upload = jobs.backup.steps.find((s) => s.uses?.startsWith('actions/upload-artifact'));
    expect(upload?.with).toMatchObject({ name: 'backups-${{ github.run_id }}', path: 'web/out/*.dump.gpg', 'retention-days': 14 });
  });
  it('uses the newest PostgreSQL client, never a pinned older one', () => {
    for (const job of Object.values(jobs)) expect(JSON.stringify(job)).not.toContain('postgresql/17');
  });
  it('keeps every company and the control project awake with an endpoint the anon key may call', () => {
    const keep = runOf(jobs.backup, 'Keep');
    expect(keep).toContain('/auth/v1/health');
    expect(keep).toContain('"$RUNNER_TEMP"/tenants/*.env');
    expect(keep).toContain('CONTROL_SUPABASE_URL');
  });
  it('verify mode checks every file: companies have patients and sign-in accounts, control has tenants', () => {
    const verify = runOf(jobs.verify, 'Decrypt');
    expect(verify).toContain('TABLE DATA public patients');
    expect(verify).toContain('TABLE DATA auth users');
    expect(verify).toContain('TABLE DATA public tenants');
    expect(verify).toContain('for f in in/*.dump.gpg');
    expect(runOf(jobs.verify, 'Download')).toContain('startswith("backups-")');
    expect(verify).toContain('Backup problem');
    expect(verify).toContain('registry file missing');
    expect(verify).toContain('no company files');
  });
});
