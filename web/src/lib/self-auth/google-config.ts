/**
 * Google sign-in settings: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, both or neither. Neither set: Google sign-in
 * is off (null). One alone is a configuration mistake and throws naming the missing one.
 * No 'server-only' here: scripts and tests load it under tsx and Vitest.
 */
export function googleConfig(
  env: Record<string, string | undefined> = process.env,
): { clientId: string; clientSecret: string } | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId && !clientSecret) return null;
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID is not set (GOOGLE_CLIENT_SECRET is; set both or neither)');
  if (!clientSecret) throw new Error('GOOGLE_CLIENT_SECRET is not set (GOOGLE_CLIENT_ID is; set both or neither)');
  return { clientId, clientSecret };
}
