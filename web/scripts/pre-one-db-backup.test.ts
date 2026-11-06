import { describe, expect, it } from 'vitest';
import { countsSql, dumpMismatch, pgDumpArgs, redact, settingsMarkdown } from './pre-one-db-backup-lib';

describe('pgDumpArgs', () => {
  it('dumps everything, auth and ACLs included (the release 4 rollback replays the grants)', () => {
    expect(pgDumpArgs('full', '/out/full.dump')).toEqual(['--format=custom', '--no-owner', '--file=/out/full.dump']);
  });
  it('adds --schema-only for the schema dump', () => {
    expect(pgDumpArgs('schema', '/out/schema.dump')).toContain('--schema-only');
  });
});

describe('settingsMarkdown', () => {
  const md = settingsMarkdown({
    label: 'academy',
    host: 'db.example.supabase.co',
    ref: 'example',
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
  it('records the project ref, which dumpMismatch reads back', () => {
    expect(md).toContain('- Project ref: example');
    expect(dumpMismatch(md, 'example')).toBeNull();
    expect(dumpMismatch(md, 'other')).toMatch(/taken from project example, the target is other/);
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

describe('dumpMismatch', () => {
  it('refuses a dump without settings.md or without a recorded ref', () => {
    expect(dumpMismatch(null, 'abc')).toMatch(/no settings\.md/);
    expect(dumpMismatch('# Settings snapshot: academy\n\n- Host: db.abc.supabase.co\n', 'abc')).toMatch(/records no project ref/);
  });
  it('accepts only the same ref', () => {
    expect(dumpMismatch('- Host: h\n- Project ref: abc\n- Server: x\n', 'abc')).toBeNull();
    expect(dumpMismatch('- Project ref: abc\r\n', 'abd')).toMatch(/project abc, the target is abd/);
  });
});
