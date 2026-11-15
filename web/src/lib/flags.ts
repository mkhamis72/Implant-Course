type Env = Record<string, string | undefined>;

export const PILOT_MESSAGE = 'Pilot: only test patients or patients who consented to the pilot.';

/** Invites need working email (Supabase SMTP). Off in the pilot: EMAIL_ENABLED=false. */
export function emailEnabled(env: Env = process.env): boolean {
  return env.EMAIL_ENABLED !== 'false';
}

/** Pilot banner on every signed-in page: NEXT_PUBLIC_PILOT=1. */
export function pilotMode(env: Env = process.env): boolean {
  return env.NEXT_PUBLIC_PILOT === '1';
}
