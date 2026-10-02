// Pins the safety properties of the release and backup workflows (production is changed only by these).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

type Step = { name?: string; run?: string; uses?: string; with?: Record<string, unknown> };
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
});

// Secrets pasted on Windows can carry a trailing CR/LF; every step strips it before use
// (a CR in the hook URL breaks curl; in the passphrase it would silently change the key).
const CLEAN = `clean() { printf '%s' "$1" | tr -d '\\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }`;
const cleans = (run: string, name: string) => run.includes(CLEAN) && run.includes(`${name}="$(clean "$${name}")"`);

describe('secrets are cleaned of stray line endings before use', () => {
  const release = load('release.yml').jobs['migrate-and-deploy'];
  const backup = load('backup.yml').jobs;
  it('release: database URL, CA certificate and deploy hook', () => {
    expect(cleans(runOf(release, 'Migrate'), 'DATABASE_URL')).toBe(true);
    expect(cleans(runOf(release, 'Migrate'), 'PROD_DATABASE_CA_CERT')).toBe(true);
    expect(cleans(runOf(release, 'Deploy'), 'HOOK')).toBe(true);
  });
  it('backup and verify: passphrase, database URL, CA certificate and REST keys', () => {
    const dump = runOf(backup.backup, 'Dump');
    for (const n of ['PASSPHRASE', 'DATABASE_URL', 'CA']) expect(cleans(dump, n)).toBe(true);
    for (const n of ['URL', 'ANON']) expect(cleans(runOf(backup.backup, 'Keep'), n)).toBe(true);
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
  it('dumps the data a restore needs: app tables and sign-in accounts, without migration bookkeeping', () => {
    expect(dump).toContain('--data-only');
    expect(dump).toContain('--schema=auth');
    expect(dump).toContain('--exclude-table=app_private.schema_migrations');
    expect(dump).toContain('--exclude-table=auth.schema_migrations');
    expect(dump).toMatch(/pg_dump[^|]*\\\s*\n\s*\| gpg/);
  });
  it('uses the newest PostgreSQL client, never a pinned older one', () => {
    for (const job of Object.values(jobs)) expect(JSON.stringify(job)).not.toContain('postgresql/17');
  });
  it('keeps the project awake with an endpoint the anon key may call', () => {
    expect(runOf(jobs.backup, 'Keep')).toContain('/auth/v1/health');
  });
  it('verify mode checks that sign-in accounts are in the backup', () => {
    expect(runOf(jobs.verify, 'Decrypt')).toContain('TABLE DATA auth users');
  });
});
