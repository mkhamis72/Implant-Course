import { describe, expect, it } from 'vitest';
import { countsSql, pgDumpArgs, redact, settingsMarkdown } from './pre-one-db-backup-lib';

describe('pgDumpArgs', () => {
  it('dumps everything, auth included', () => {
    expect(pgDumpArgs('full', '/out/full.dump')).toEqual(['--format=custom', '--no-owner', '--no-acl', '--file=/out/full.dump']);
  });
  it('adds --schema-only for the schema dump', () => {
    expect(pgDumpArgs('schema', '/out/schema.dump')).toContain('--schema-only');
  });
});

describe('settingsMarkdown', () => {
  const md = settingsMarkdown({
    label: 'academy',
    host: 'db.example.supabase.co',
    serverVersion: 'PostgreSQL 17.0',
    envNames: ['DATABASE_URL', 'SMTP_PASS'],
    vaultNames: ['tenant/academy/service_role_key'],
  });
  it('lists every env and vault name', () => {
    for (const n of ['DATABASE_URL', 'SMTP_PASS', 'tenant/academy/service_role_key']) expect(md).toContain(n);
  });
  it('never shows a value after an env name', () => {
    expect(md).not.toMatch(/DATABASE_URL\s*=/);
    expect(md).not.toMatch(/SMTP_PASS\s*=/);
  });
  it('ends with an Owner fills in section', () => {
    expect(md).toContain('Owner fills in');
  });
});

describe('redact', () => {
  it('removes every secret', () => {
    const out = redact('connect postgresql://u:pw@h/db failed', ['postgresql://u:pw@h/db', 'pw']);
    expect(out).not.toContain('postgresql://u:pw@h/db');
    expect(out).not.toContain('pw');
    expect(out).toContain('[redacted]');
  });
});

describe('countsSql', () => {
  it('counts ordinary and partitioned tables in the three schemas', () => {
    const sql = countsSql();
    expect(sql).toMatch(/relkind in \('r','p'\)/);
    for (const s of ['public', 'app_private', 'auth']) expect(sql).toContain(`'${s}'`);
  });
});
