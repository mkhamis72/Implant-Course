import type { SelfAuth } from '@mkhamis72/self-auth';

/**
 * The tenant Self-Auth instance for scripts and tests. src/lib/self-auth/tenant.ts is the app's own, but it
 * imports 'server-only' (a build-time guard that throws outside Next), so it can't load under tsx, Vitest or
 * Playwright. This one has the same database, secret and signing key; its mail adapter keeps messages in
 * memory (`sentEmails`) instead of sending them, and its links point at a placeholder host.
 */
export const sentEmails: { to: string; kind: 'invite' | 'reset'; companyId: string; url: string }[] = [];

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return v;
}

async function build(url: string, secretVar: string): Promise<SelfAuth> {
  // Dynamic: the package is ESM-only, and Playwright loads these files as CommonJS.
  const { createSelfAuth } = await import('@mkhamis72/self-auth');
  return createSelfAuth({
    databaseUrl: url,
    secret: required(secretVar),
    appName: 'Implant Course',
    dbToken: { privateJwk: JSON.parse(required('SELF_AUTH_PRIVATE_JWK')), kid: required('SELF_AUTH_KID') },
    email: { send: async (m) => { sentEmails.push({ to: m.to, kind: m.kind, companyId: m.companyId, url: m.url }); } },
    links: {
      resetPassword: (companyId, token) => `http://${companyId}.localhost:3000/auth/reset?token=${token}`,
      acceptInvite: (companyId, token) => `http://${companyId}.localhost:3000/auth/invite?token=${token}`,
    },
  });
}

let instance: Promise<SelfAuth> | null = null;
let consoleInstance: Promise<SelfAuth> | null = null;

/** One instance per process, on SELF_AUTH_DATABASE_URL || DATABASE_URL. Call closeNodeAuth() when the process should end. */
export function nodeAuth(): Promise<SelfAuth> {
  instance ??= (async () => {
    const url = process.env.SELF_AUTH_DATABASE_URL || process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set (see .env.example)');
    return build(url, 'SELF_AUTH_SECRET');
  })().catch((e) => { instance = null; throw e; });
  return instance;
}

/** The console's instance (company 'console'), on CONTROL_DATABASE_URL, signing with CONTROL_SELF_AUTH_SECRET. */
export function nodeConsoleAuth(): Promise<SelfAuth> {
  consoleInstance ??= (async () => {
    const url = process.env.CONTROL_DATABASE_URL;
    if (!url) throw new Error('CONTROL_DATABASE_URL is not set (see .env.example)');
    return build(url, 'CONTROL_SELF_AUTH_SECRET');
  })().catch((e) => { consoleInstance = null; throw e; });
  return consoleInstance;
}

export async function closeNodeAuth(): Promise<void> {
  for (const which of ['tenant', 'console'] as const) {
    const p = which === 'tenant' ? instance : consoleInstance;
    if (which === 'tenant') instance = null; else consoleInstance = null;
    if (p) await (await p).close();
  }
}
