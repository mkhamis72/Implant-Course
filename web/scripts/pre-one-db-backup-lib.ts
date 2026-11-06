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

/** Project ref from a database URL: db.<ref>.supabase.co, or the pooler user postgres.<ref>; otherwise the host. */
export function projectRef(databaseUrl: string): string {
  const u = new URL(databaseUrl);
  return u.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1] ?? decodeURIComponent(u.username).split('.')[1] ?? u.hostname;
}

/** The project ref a dump's settings.md records (`- Project ref: <ref>`), or null when it has none. */
export function settingsRef(settingsMd: string | null): string | null {
  return settingsMd?.match(/^- Project ref: (\S+)\s*$/m)?.[1] ?? null;
}

/** Null when the dump belongs to the target project; otherwise why the rollback must refuse. */
export function dumpMismatch(settingsMd: string | null, targetRef: string): string | null {
  if (settingsMd === null) return 'Refusing: no settings.md beside the dump, so it cannot be tied to this project';
  const ref = settingsRef(settingsMd);
  if (!ref) return 'Refusing: settings.md records no project ref (the dump was taken by an older backup:pre-one-db); take a new dump';
  return ref === targetRef ? null : `Refusing: the dump was taken from project ${ref}, the target is ${targetRef}`;
}

export function settingsMarkdown(s: { label: string; host: string; ref: string; serverVersion: string; envNames: string[]; vaultNames: string[] }): string {
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join('\n') : '- (none)');
  return `# Settings snapshot: ${s.label}

- Host: ${s.host}
- Project ref: ${s.ref}
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
