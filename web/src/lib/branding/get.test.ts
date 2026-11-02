// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }));
const rethrow = vi.fn();
vi.mock('next/navigation', () => ({ unstable_rethrow: (e: unknown) => rethrow(e) }));

const tenant = vi.fn();
vi.mock('@/lib/tenant/current', () => ({ currentTenant: () => tenant() }));
const createClient = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClient() }));

import { DEFAULT_BRANDING } from './branding';

// getBranding is wrapped in React's cache(); load a fresh copy per test so results are not memoised across tests.
const load = async () => {
  vi.resetModules();
  return (await import('./get')).getBranding;
};

const rpc = vi.fn();
const clientReturning = (result: unknown) => ({
  rpc: (...args: unknown[]) => {
    rpc(...args);
    return { maybeSingle: async () => result };
  },
});

describe('getBranding', () => {
  beforeEach(() => {
    createClient.mockReset();
    rethrow.mockReset();
    rpc.mockReset();
    tenant.mockReset();
    tenant.mockResolvedValue({ companyId: 'c1' });
  });

  it('maps the stored row', async () => {
    createClient.mockResolvedValue(
      clientReturning({ data: { name: 'Acme', brand_color: null, nav_color: null, logo_version: 0, has_logo: false }, error: null }),
    );
    expect((await (await load())()).name).toBe('Acme');
  });

  it("reads the host's company through branding_for", async () => {
    createClient.mockResolvedValue(clientReturning({ data: null, error: null }));
    await (await load())();
    expect(rpc).toHaveBeenCalledWith('branding_for', { p_company: 'c1' });
  });

  it('falls back to the default look when the request has no company', async () => {
    tenant.mockRejectedValue(new Error('No company for this request'));
    createClient.mockResolvedValue(clientReturning({ data: { name: 'Acme' }, error: null }));
    expect(await (await load())()).toEqual(DEFAULT_BRANDING);
  });

  it('falls back to the default look when the read errors', async () => {
    createClient.mockResolvedValue(clientReturning({ data: null, error: { message: 'boom' } }));
    expect(await (await load())()).toEqual(DEFAULT_BRANDING);
  });

  it('falls back to the default look when the client throws', async () => {
    expect(await (await load())()).toEqual(DEFAULT_BRANDING);
    expect(await (await load())()).toEqual(DEFAULT_BRANDING);
  });

  it('hands every caught error to Next so its control-flow signals can pass through', async () => {
    const signal = new Error('NEXT_SIGNAL');
    createClient.mockImplementation(async () => {
      throw signal;
    });
    rethrow.mockImplementation((e) => {
      throw e;
    });
    // unstable_rethrow throws for Next's own signals: getBranding must then reject, not return the default look
    const result = (await load())().then(
      () => 'resolved',
      () => 'rejected',
    );
    expect(await result).toBe('rejected');
    expect(rethrow).toHaveBeenCalledWith(signal);
  });
});
