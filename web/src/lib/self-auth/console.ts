import 'server-only';
import { buildSelfAuth, cached } from './create';

export { CONSOLE_COMPANY } from './constants';

/** Self-Auth for the console, in the control database (schema self_auth). */
export const consoleAuth = cached(() => {
  const url = process.env.CONTROL_DATABASE_URL;
  if (!url) throw new Error('CONTROL_DATABASE_URL is not set (see .env.example)');
  return buildSelfAuth(url, 'CONTROL_SELF_AUTH_SECRET');
});
