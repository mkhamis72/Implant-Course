/** Pure helpers for the restore-point backup (`npm run backup:pre-one-db`). */

export function pgDumpArgs(kind: 'full' | 'schema', outFile: string): string[] {
  // No --schema filter: the auth schema (users, identities) must be in the restore point. ACLs are kept: the release 4
  // rollback (window-rollback.ts) replays them; restores that don't want them pass --no-acl to pg_restore.
  const args = ['--format=custom', '--no-owner'];
  if (kind === 'schema') args.push('--schema-only');
  args.push(`--file=${outFile}`);
  return args;
}

/** Exact row count of every ordinary or partitioned table in public, app_private and auth. */
export function countsSql(): string {
  return `select n.nspname || '.' || c.relname as "table",
  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint as rows
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','p') and n.nspname in ('public','app_private','auth')
order by 1`;
}

export function settingsMarkdown(s: { label: string; host: string; serverVersion: string; envNames: string[]; vaultNames: string[] }): string {
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join('\n') : '- (none)');
  return `# Settings snapshot: ${s.label}

- Host: ${s.host}
- Server: ${s.serverVersion}

## Environment variable names (values are not recorded)

${list(s.envNames)}

## Vault secret names (values are not recorded)

${list(s.vaultNames)}

## Owner fills in

- Auth providers:
- Redirect URLs:
- Email templates:
- Plan, backup / PITR status:
- Latest backup time:
`;
}

/** Replace every secret (longest first, empty ones ignored) so output is safe to print. */
export function redact(text: string, secrets: string[]): string {
  return [...new Set(secrets.filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .reduce((out, secret) => out.split(secret).join('[redacted]'), text);
}
