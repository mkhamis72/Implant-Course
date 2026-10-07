import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pgConfig } from './db';

const url = 'postgresql://u:p@host:5432/postgres';

describe('pgConfig', () => {
  it('verifies the server certificate when a CA file is given', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ca-'));
    const ca = path.join(dir, 'ca.crt');
    writeFileSync(ca, 'CERT');
    expect(pgConfig({ DATABASE_URL: url, DATABASE_CA_CERT: ca }).ssl).toEqual({ ca: 'CERT' });
  });
  it('allows an unverified connection only for the allow-listed dev project', () => {
    expect(pgConfig({ DATABASE_URL: url, ALLOW_TEST_FIXTURES: '1' }).ssl).toEqual({ rejectUnauthorized: false });
    expect(() => pgConfig({ DATABASE_URL: url })).toThrow(/DATABASE_CA_CERT/);
  });
  it('connects without TLS to a local Supabase stack', () => {
    expect(pgConfig({ DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' }).ssl).toBe(false);
    expect(pgConfig({ DATABASE_URL: 'postgresql://postgres:postgres@localhost:54322/postgres' }).ssl).toBe(false);
  });
});
