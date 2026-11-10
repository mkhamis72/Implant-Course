import 'server-only';
import { createSelfAuth, type SelfAuth } from '@mkhamis72/self-auth';
import { emailAdapter } from './email';
import { inviteLink, resetLink } from './links';
import { scopeForSecret, signingKey } from './signing-key';
import { databaseCa } from './database-ca';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return v;
}

/** One Self-Auth instance. The console signs database tokens with its own key pair when one is set (signing-key.ts). */
export function buildSelfAuth(databaseUrl: string, secretVar: string): Promise<SelfAuth> {
  return createSelfAuth({
    databaseUrl,
    databaseCa: databaseCa(),
    secret: required(secretVar),
    appName: 'Implant Course',
    dbToken: signingKey(scopeForSecret(secretVar)),
    email: emailAdapter,
    links: { resetPassword: resetLink, acceptInvite: inviteLink },
    // The context never carries tokens or URLs; log only the operation and the error's message.
    onError: (err, { op }) => console.error(`self-auth ${op} failed:`, err instanceof Error ? err.message : 'unknown'),
  });
}

/** Caches the promise per process; a failed build is retried next call. */
export function cached(build: () => Promise<SelfAuth>): () => Promise<SelfAuth> {
  let p: Promise<SelfAuth> | null = null;
  return () => {
    p ??= (async () => build())().catch((e) => { p = null; throw e; });
    return p;
  };
}
