/**
 * The key pair a Self-Auth instance signs database tokens with. Supabase lets a key id live in one project only,
 * so the console (control project) can have its own: CONTROL_SELF_AUTH_PRIVATE_JWK + CONTROL_SELF_AUTH_KID, both
 * or neither. Without them it shares SELF_AUTH_PRIVATE_JWK + SELF_AUTH_KID (one local stack, tests).
 * No 'server-only' here: scripts and tests load it under tsx and Vitest.
 */
export type KeyScope = 'tenant' | 'console';
export type SigningKey = { privateJwk: Record<string, unknown>; kid: string };
type Env = Record<string, string | undefined>;

export function scopeForSecret(secretVar: string): KeyScope {
  return secretVar === 'CONTROL_SELF_AUTH_SECRET' ? 'console' : 'tenant';
}

function required(env: Env, name: string): string {
  const v = env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return v;
}

// JSON.parse errors can quote part of the input, which here is a private key: drop them.
function parseJwk(raw: string, name: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${name} is not valid JSON`);
  }
}

export function signingKey(scope: KeyScope, env: Env = process.env): SigningKey {
  const own = scope === 'console' && (env.CONTROL_SELF_AUTH_PRIVATE_JWK?.trim() || env.CONTROL_SELF_AUTH_KID?.trim());
  const [jwkVar, kidVar] = own
    ? ['CONTROL_SELF_AUTH_PRIVATE_JWK', 'CONTROL_SELF_AUTH_KID']
    : ['SELF_AUTH_PRIVATE_JWK', 'SELF_AUTH_KID'];
  const kid = required(env, kidVar);
  return { privateJwk: parseJwk(required(env, jwkVar), jwkVar), kid };
}
