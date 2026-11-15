import 'server-only';
import { RegistryUnavailableError, type Tenant } from './types';

export const FRESH_MS = 60_000;
/** After this the cached list is too old to route by: requests get "service unavailable". */
export const STALE_MS = 10 * 60_000;
const RETRY_MS = 15_000;

export type ListCache = { get(now?: number): Promise<Tenant[]>; reset(): void };

/** A company list: fresh for 60 s, then refetched; a failed refetch keeps the old list for 10 min (retried every 15 s). */
export function createListCache(fetchList: () => Promise<Tenant[]>): ListCache {
  let cache: { tenants: Tenant[]; fetchedAt: number } | null = null;
  let inflight: Promise<Tenant[]> | null = null;
  let lastFailureAt: number | null = null;
  // Bumped by reset(): a fetch started before it never writes the cache (it would put back the older list).
  let generation = 0;

  const self: ListCache = {
    reset() {
      generation += 1;
      cache = null;
      inflight = null;
      lastFailureAt = null;
    },
    get(now = Date.now()) {
      if (cache && now - cache.fetchedAt < FRESH_MS) return Promise.resolve(cache.tenants);
      if (cache && lastFailureAt !== null && now - lastFailureAt < RETRY_MS && now - cache.fetchedAt < STALE_MS) {
        return Promise.resolve(cache.tenants);
      }
      if (inflight) return inflight;
      const mine = generation;
      const p: Promise<Tenant[]> = Promise.resolve()
        .then(fetchList)
        .then((tenants) => {
          if (mine === generation) {
            cache = { tenants, fetchedAt: now };
            lastFailureAt = null;
          }
          return tenants;
        })
        .catch((error) => {
          // Started before a reset: its failure says nothing about the list now, so ask again (a fresh fetch).
          if (mine !== generation) return self.get(now);
          lastFailureAt = now;
          if (cache && now - cache.fetchedAt < STALE_MS) {
            console.error('Tenant registry refresh failed; serving the cached registry', error);
            return cache.tenants;
          }
          throw new RegistryUnavailableError(error);
        })
        .finally(() => {
          if (inflight === p) inflight = null;
        });
      inflight = p;
      return p;
    },
  };
  return self;
}
