import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { config as loadDotenv, parse } from 'dotenv';

/**
 * The second local Supabase stack ("dev2", the second company for the isolation E2E tests).
 *   tsx scripts/dev2-stack.ts config   writes .dev2/supabase/config.toml from supabase/config.toml
 *   tsx scripts/dev2-stack.ts env      writes .env.dev2 and tenants.local.json from both running stacks
 * Never prints keys.
 */
const PORT_OFFSET = 100;
const PORT_KEY = /^(\s*#?\s*)((?:\w+_)?port)(\s*=\s*)(\d+)(.*)$/;

/** Pure: stack 1's config → dev2's (own project id, ports +100, Studio off; the CLI signs the default API keys, so the JWT secret can't differ). */
export function deriveDev2Config(source: string): string {
  let section = '';
  return source
    .split(/\r?\n/)
    .flatMap((line) => {
      const header = /^\s*\[([^\]]+)\]/.exec(line);
      if (header) section = header[1];
      if (/^project_id\s*=/.test(line)) return ['project_id = "implant-course-dev2"'];
      const port = PORT_KEY.exec(line);
      // Values below 1024 are external services (a commented SMTP example), not ports of this stack.
      if (port && Number(port[4]) >= 1024) return [`${port[1]}${port[2]}${port[3]}${Number(port[4]) + PORT_OFFSET}${port[5]}`];
      if (section === 'studio' && /^enabled\s*=/.test(line)) return ['enabled = false'];
      return [line];
    })
    .join('\n');
}

type Status = { API_URL: string; ANON_KEY: string; SERVICE_ROLE_KEY: string; DB_URL: string };

function status(workdir?: string): Status {
  const args = ['supabase', 'status', '-o', 'json', ...(workdir ? ['--workdir', workdir] : [])];
  const out = execFileSync('npx', args, { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out.slice(out.indexOf('{')));
}

function writeConfig() {
  mkdirSync('.dev2/supabase/templates', { recursive: true });
  writeFileSync('.dev2/supabase/config.toml', deriveDev2Config(readFileSync('supabase/config.toml', 'utf8')));
  for (const t of ['invite.html', 'recovery.html']) copyFileSync(`supabase/templates/${t}`, `.dev2/supabase/templates/${t}`);
  console.log('Wrote .dev2/supabase/config.toml');
}

function writeEnv() {
  const base = parse(readFileSync('.env.local', 'utf8'));
  const one = status();
  const two = status('.dev2');
  const lines = [
    `NEXT_PUBLIC_SUPABASE_URL=${two.API_URL}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${two.ANON_KEY}`,
    `SUPABASE_SERVICE_ROLE_KEY=${two.SERVICE_ROLE_KEY}`,
    `DATABASE_URL=${two.DB_URL}`,
    'DATABASE_CA_CERT=',
    'SITE_URL=http://tenant2.localhost:3000',
    'ALLOW_TEST_FIXTURES=1',
    'TEST_SUPABASE_PROJECT_REF=local',
    `TEST_USER_PASSWORD=${base.TEST_USER_PASSWORD ?? ''}`,
  ];
  writeFileSync('.env.dev2', lines.join('\n') + '\n');
  const entry = (slug: string, host: string, s: Status, extra = {}) => ({
    slug, hosts: [host], supabaseUrl: s.API_URL, anonKey: s.ANON_KEY, serviceRoleKey: s.SERVICE_ROLE_KEY, ...extra,
  });
  const tenants = [
    entry('dev', 'localhost', one),
    entry('dev2', 'tenant2.localhost', two),
    entry('paused', 'paused.localhost', one, { status: 'suspended' }),
  ];
  writeFileSync('tenants.local.json', JSON.stringify(tenants, null, 2) + '\n');
  console.log('Wrote .env.dev2 and tenants.local.json');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  loadDotenv({ quiet: true });
  const cmd = process.argv[2];
  if (cmd === 'config') writeConfig();
  else if (cmd === 'env') writeEnv();
  else {
    console.error('Usage: tsx scripts/dev2-stack.ts config|env');
    process.exit(1);
  }
}
