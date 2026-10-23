import type { NextConfig } from 'next';
import { staticSecurityHeaders } from './src/lib/security-headers';

const nextConfig: NextConfig = {
  // The dev badge sits over the nav's bottom-left Sign out button.
  devIndicators: false,
  // Extra local hostnames for the two-company isolation tests; without this pages on them don't hydrate in dev.
  allowedDevOrigins: ['tenant2.localhost', 'paused.localhost', 'nobody.localhost', 'console.localhost'],
  // analysis.R is read from the source tree at run time (src/lib/research/export/analysis.ts).
  outputFileTracingIncludes: {
    '/patients/research/export': ['./src/lib/research/export/analysis.R'],
    '/patients/research/analysis.R': ['./src/lib/research/export/analysis.R'],
  },
  // Signed consent scans (≤ 2 MB) go through a server action; as form data 2 MB is about 2.7 MB (Vercel allows 4.5 MB).
  experimental: {
    serverActions: { bodySizeLimit: '3mb' },
  },
  async headers() {
    // The CSP depends on the company and is set per request by the middleware.
    return [{ source: '/:path*', headers: staticSecurityHeaders() }];
  },
};

export default nextConfig;
