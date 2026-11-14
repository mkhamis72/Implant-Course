import 'server-only';
import { tenantAuth } from './tenant';

export { CONSOLE_COMPANY } from './constants';

/**
 * The console's Self-Auth: the company instance (company 'console' in the one database's self_auth tables). Every
 * call takes the company id, so a company session is never a console one.
 */
export const consoleAuth = tenantAuth;
