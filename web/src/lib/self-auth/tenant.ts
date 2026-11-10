import 'server-only';
import { buildSelfAuth, cached } from './create';

/**
 * Self-Auth for the companies, in the shared company database (schema self_auth). SELF_AUTH_DATABASE_URL
 * (a session-pooler URL) wins over DATABASE_URL when the pooler in DATABASE_URL drops `options=-c search_path`.
 */
export const tenantAuth = cached(() => {
  const url = process.env.SELF_AUTH_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (see .env.example)');
  return buildSelfAuth(url, 'SELF_AUTH_SECRET');
});
