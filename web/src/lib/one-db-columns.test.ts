import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// Release 5 drops profiles.role / active / delegate_id / mfa_setup_required: they live in company_members now.
// Nothing in web/src may still name them on a profiles query or a profiles embed.
const OLD_COLUMNS = /\b(role|active|delegate_id|mfa_setup_required)\b/;
const SRC = join(__dirname, '..');
const FROM_PROFILES = /from\(\s*['"`]profiles['"`]\s*\)((?:(?!\bfrom\()[^;])*)/g;

/** Each place in `source` where a profiles query or embed names one of the old columns. */
export function oldProfileColumnUses(source: string): string[] {
  const found: string[] = [];
  // from('profiles') … up to the end of the statement or the next from(…): its select / eq / update / order strings and keys.
  for (const m of source.matchAll(FROM_PROFILES)) {
    if (OLD_COLUMNS.test(m[1])) found.push(`from('profiles')${m[1]}`.replace(/\s+/g, ' ').slice(0, 160));
  }
  // Embeds: profiles(…), profiles!fk(…), alias:profiles!fk(…).
  for (const m of source.matchAll(/\bprofiles(?:!\w+)?\(([^)]*)\)/g)) {
    if (OLD_COLUMNS.test(m[1])) found.push(m[0]);
  }
  // Embeds through a foreign-key column, which may point at profiles: created_by(…), creator:created_by(…),
  // done_by:assignee_id!fk(…). The alias or the relation ends in _id or _by.
  // A lookahead, so an embed inside select('…') is still seen; one report per embed.
  let reportedUpTo = 0;
  for (const m of source.matchAll(/\b(?=((\w+)(?::(\w+))?(?:!\w+)?\(([^)]*)\)))/g)) {
    if (m.index < reportedUpTo) continue;
    if ([m[2], m[3]].some((n) => n && /(_id|_by)$/.test(n)) && OLD_COLUMNS.test(m[4])) {
      found.push(m[1]);
      reportedUpTo = m.index + m[1].length;
    }
  }
  return [...new Set(found)];
}

/** How many from('profiles') queries `source` has: the scan must see some, or it passes on nothing. */
export const profileQueryCount = (source: string) => [...source.matchAll(FROM_PROFILES)].length;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [path] : [];
  });
}

describe('the old profile columns', () => {
  it('finds them on a profiles query or embed, not on company_members', () => {
    expect(oldProfileColumnUses(`db.from('profiles').select('user_id', { head: true }).eq('active', true);`)).toHaveLength(1);
    expect(oldProfileColumnUses(`db.from('profiles').update({ full_name: n, role: 'admin' }).eq('user_id', id);`)).toHaveLength(1);
    expect(oldProfileColumnUses(`.select('id, creator:profiles!x_fkey(full_name, mfa_setup_required)')`)).toHaveLength(1);
    expect(oldProfileColumnUses(`.select('id, creator:created_by(full_name, role)')`)).toHaveLength(1);
    expect(oldProfileColumnUses(`.select('id, created_by(active)')`)).toHaveLength(1);
    expect(oldProfileColumnUses(`.select('id, done_by:assignee_id!x_fkey(delegate_id)')`)).toHaveLength(1);
    expect(oldProfileColumnUses(`.select('id, creator:created_by(full_name, email)')`)).toEqual([]);
    expect(oldProfileColumnUses(`db.from('profiles').select('full_name, email').eq('user_id', id);`)).toEqual([]);
    expect(oldProfileColumnUses(`[db.from('profiles').select('user_id'), db.from('company_members').select('role')];`)).toEqual([]);
    expect(oldProfileColumnUses(`db.from('company_members').select('role, active, delegate_id, mfa_setup_required, profile:profiles(full_name, email)');`)).toEqual([]);
  });

  it('are named nowhere in web/src', () => {
    const files = sourceFiles(SRC).map((file) => ({ file, source: readFileSync(file, 'utf8') }));
    expect(files.reduce((n, f) => n + profileQueryCount(f.source), 0)).toBeGreaterThanOrEqual(5);
    const uses = files.flatMap(({ file, source }) => oldProfileColumnUses(source).map((use) => `${relative(SRC, file)}: ${use}`));
    expect(uses).toEqual([]);
  });
});
