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
  it('a reset during a fetch: the older fetch never overwrites the newer list', async () => {
    const older: Tenant = { ...t, slug: 'old' };
    const newer: Tenant = { ...t, slug: 'new' };
    let releaseOld!: (v: Tenant[]) => void;
    const fetch = vi.fn()
      .mockImplementationOnce(() => new Promise<Tenant[]>((r) => { releaseOld = r; }))
      .mockResolvedValueOnce([newer]);
    const c = createListCache(fetch);
    const first = c.get(0);
    c.reset();
    expect(await c.get(1)).toEqual([newer]);
    releaseOld([older]);
    await first;
    expect(await c.get(2)).toEqual([newer]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('a fetch from before a reset that fails: its caller gets the list from a fresh fetch, not "unavailable"', async () => {
    let failOld!: (e: Error) => void;
    const fetch = vi.fn()
      .mockImplementationOnce(() => new Promise<Tenant[]>((_, reject) => { failOld = reject; }))
      .mockResolvedValue([t]);
    const c = createListCache(fetch);
    const first = c.get(0);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    c.reset();
    failOld(new Error('connection reset'));
    expect(await first).toEqual([t]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
