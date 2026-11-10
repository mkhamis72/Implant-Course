/**
 * Google sign-in settings: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, both or neither. Neither set: Google sign-in
 * is off (null). One alone is a configuration mistake: Google stays off (null) so password sign-in keeps working,
 * and the missing variable's name (never a value) is logged once per process.
 * No 'server-only' here: scripts and tests load it under tsx and Vitest.
 */
let loggedHalfSet = false;

export function googleConfig(
  env: Record<string, string | undefined> = process.env,
): { clientId: string; clientSecret: string } | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (clientId && clientSecret) return { clientId, clientSecret };
  if (!clientId && !clientSecret) return null;
  if (!loggedHalfSet) {
    loggedHalfSet = true;
    const [missing, present] = clientId
      ? ['GOOGLE_CLIENT_SECRET', 'GOOGLE_CLIENT_ID']
      : ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
    console.error(`${missing} is not set (${present} is; set both or neither). Google sign-in is off.`);
  }
  return null;
}
