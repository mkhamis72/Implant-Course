import type { NextConfig } from 'next';
import { staticSecurityHeaders } from './src/lib/security-headers';

const nextConfig: NextConfig = {
  // The dev badge sits over the nav's bottom-left Sign out button.
  devIndicators: false,
  // Extra local hostnames for the two-company isolation tests; without this pages on them don't hydrate in dev.
  allowedDevOrigins: ['tenant2.localhost', 'paused.localhost', 'nobody.localhost', 'console.localhost'],
  async headers() {
    // The CSP depends on the company and is set per request by the middleware.
    return [{ source: '/:path*', headers: staticSecurityHeaders() }];
  },
};

export default nextConfig;
