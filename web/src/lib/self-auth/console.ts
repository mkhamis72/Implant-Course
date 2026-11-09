import 'server-only';
import { buildSelfAuth, cached } from './create';

/** Every console user is a Self-Auth user of this one company. */
export const CONSOLE_COMPANY = 'console';

/** Self-Auth for the console, in the control database (schema self_auth). */
export const consoleAuth = cached(() => {
  const url = process.env.CONTROL_DATABASE_URL;
  if (!url) throw new Error('CONTROL_DATABASE_URL is not set (see .env.example)');
  return buildSelfAuth(url, 'CONTROL_SELF_AUTH_SECRET');
});
