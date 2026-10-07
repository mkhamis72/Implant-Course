/** One company: its own Supabase project, reached on its own host names. */
export type Tenant = {
  slug: string;
  hosts: string[];
  supabaseUrl: string;
  anonKey: string;
  status: 'active' | 'suspended';
};

/** Set by the middleware on the forwarded request; any value sent by the browser is removed first. */
export const TENANT_HEADER = 'x-tenant';

export const ADMIN_UNAVAILABLE = "This action isn't available right now. Please try again later.";

/** The control project could not be reached and the cached registry is too old to trust. */
export class RegistryUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Tenant registry unavailable', { cause });
    this.name = 'RegistryUnavailableError';
  }
}
