import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { createListCache, FRESH_MS, STALE_MS } from './list-cache';
import { RegistryUnavailableError, type Tenant } from './types';

const t: Tenant = { slug: 'a', hosts: ['a.example'], supabaseUrl: 'u', anonKey: 'k', status: 'active', companyId: 'c' };

describe('createListCache', () => {
  it('serves the list while fresh, refetches after', async () => {
    const fetch = vi.fn().mockResolvedValue([t]);
    const c = createListCache(fetch);
    expect(await c.get(0)).toEqual([t]);
    await c.get(FRESH_MS - 1);
    expect(fetch).toHaveBeenCalledTimes(1);
    await c.get(FRESH_MS + 1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('one fetch in flight at a time', async () => {
    const fetch = vi.fn().mockResolvedValue([t]);
    const c = createListCache(fetch);
    await Promise.all([c.get(0), c.get(0)]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('a failed refresh keeps the old list up to 10 min, then is unavailable', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetch = vi.fn().mockResolvedValueOnce([t]).mockRejectedValue(new Error('down'));
    const c = createListCache(fetch);
    await c.get(0);
    expect(await c.get(FRESH_MS + 1)).toEqual([t]);
    await expect(c.get(STALE_MS + 1)).rejects.toBeInstanceOf(RegistryUnavailableError);
    err.mockRestore();
  });
  it('reset forgets the list', async () => {
    const fetch = vi.fn().mockResolvedValue([t]);
    const c = createListCache(fetch);
    await c.get(0);
    c.reset();
    await c.get(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
