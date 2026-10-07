import { normaliseHost } from '@/lib/tenant/host';

export type ConsoleRoute = 'console' | 'console-root' | 'company' | 'not-found';

const isConsolePath = (path: string) => path === '/console' || path.startsWith('/console/');

/**
 * Decided before company routing. The console host serves only /console…; company hosts never do.
 * Without a console host configured the console doesn't exist.
 */
export function routeConsole(rawHost: string | null, path: string, consoleHost: string | null): ConsoleRoute {
  const host = normaliseHost(rawHost);
  if (consoleHost && host === consoleHost) {
    if (path === '/') return 'console-root';
    return isConsolePath(path) ? 'console' : 'not-found';
  }
  return isConsolePath(path) ? 'not-found' : 'company';
}
