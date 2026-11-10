/**
 * The CA that signs the database servers' certificates, as PEM text in SELF_AUTH_DATABASE_CA_CERT (Supabase:
 * Project Settings -> Database -> SSL; one root for every project). Set, Self-Auth verifies its database
 * connections against it, so the URLs then carry no sslmode. Unset (local stack): no TLS, as before.
 * No 'server-only' here: scripts and tests load it under tsx and Vitest.
 */
export function databaseCa(env: Record<string, string | undefined> = process.env): string | undefined {
  const raw = env.SELF_AUTH_DATABASE_CA_CERT?.trim();
  if (!raw) return undefined;
  const pem = raw.replace(/\\n/g, '\n');
  if (!pem.startsWith('-----BEGIN CERTIFICATE-----')) throw new Error('SELF_AUTH_DATABASE_CA_CERT is not a PEM certificate');
  return `${pem}\n`;
}
