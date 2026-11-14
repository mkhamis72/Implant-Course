import 'server-only';
import { listSource } from '@/lib/tenant/source';
import { buildSelfAuth, cached } from './create';
import { tenantAuth } from './tenant';

export { CONSOLE_COMPANY } from './constants';

/** Self-Auth for the console, in the control database (schema self_auth). */
const controlConsoleAuth = cached(() => {
  const url = process.env.CONTROL_DATABASE_URL;
  if (!url) throw new Error('CONTROL_DATABASE_URL is not set (see .env.example)');
  return buildSelfAuth(url, 'CONTROL_SELF_AUTH_SECRET');
});

/**
 * The console's Self-Auth. With COMPANY_LIST=production it is the company instance (company 'console' in the
 * production self_auth tables): every call takes the company id, so a company session is never a console one.
 */
export const consoleAuth = () => (listSource() === 'production' ? tenantAuth() : controlConsoleAuth());
