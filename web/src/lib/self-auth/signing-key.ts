/**
 * The key pair Self-Auth signs database tokens with: SELF_AUTH_PRIVATE_JWK + SELF_AUTH_KID. Since the merge of control
 * into production (release 3) the console signs in through the same instance, so there is one key pair.
 * No 'server-only' here: scripts and tests load it under tsx and Vitest.
 */
export type SigningKey = { privateJwk: Record<string, unknown>; kid: string };
type Env = Record<string, string | undefined>;

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

export function signingKey(env: Env = process.env): SigningKey {
  const kid = required(env, 'SELF_AUTH_KID');
  return { privateJwk: parseJwk(required(env, 'SELF_AUTH_PRIVATE_JWK'), 'SELF_AUTH_PRIVATE_JWK'), kid };
}
