import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportFiles } from './tenants-export';
import type { Company } from './tenant-env';

const tricky: Company = {
  tenant: { slug: 'academy', name: 'A', status: 'suspended', supabase_url: 'https://abcdefgh.supabase.co', anon_key: 'anon' },
  secrets: { serviceRoleKey: 'svc', databaseUrl: "postgresql://postgres.abcdefgh:p'a$s`w\"d@pooler:5432/postgres" },
};

describe('exportFiles', () => {
  it('writes one file per company with exactly the four variables the backup needs', () => {
    const [f] = exportFiles([tricky]);
    expect(f.file).toBe('academy.env');
    expect(f.text.split('\n').filter(Boolean).map((l) => l.split('=')[0])).toEqual(['SLUG', 'DATABASE_URL', 'SUPABASE_URL', 'ANON_KEY']);
    expect(f.text).not.toContain('svc');
  });

  it('sources back to the exact values in bash, quotes and $ included', () => {
    const [f] = exportFiles([tricky]);
    const dir = mkdtempSync(path.join(tmpdir(), 'tenants-'));
    writeFileSync(path.join(dir, f.file), f.text);
    const out = execFileSync('bash', ['-c', `source "${path.join(dir, f.file).replaceAll('\\', '/')}" && printf '%s' "$DATABASE_URL"`]).toString();
    expect(out).toBe(tricky.secrets.databaseUrl);
  });
});
