import type { NextConfig } from 'next';
import { staticSecurityHeaders } from './src/lib/security-headers';

const nextConfig: NextConfig = {
  // The dev badge sits over the nav's bottom-left Sign out button.
  devIndicators: false,
  // Extra local hostnames for the two-company isolation tests; without this pages on them don't hydrate in dev.
  allowedDevOrigins: ['tenant2.localhost', 'paused.localhost', 'nobody.localhost', 'console.localhost'],
  // analysis.R is read from the source tree at run time (src/lib/research/export/analysis.ts).
  outputFileTracingIncludes: {
    '/statistics/export': ['./src/lib/research/export/analysis.R'],
    '/statistics/analysis.R': ['./src/lib/research/export/analysis.R'],
  },
  // Signed consent scans (≤ 2 MB) go through a server action; as form data 2 MB is about 2.7 MB (Vercel allows 4.5 MB).
  experimental: {
    serverActions: { bodySizeLimit: '3mb' },
  },
  // Research moved out of Patients into its own Statistics module (2026-10).
  async redirects() {
    return [
      { source: '/patients/research', destination: '/statistics', permanent: false },
      { source: '/patients/research/:path*', destination: '/statistics/:path*', permanent: false },
    ];
  },
  async headers() {
    // The CSP depends on the company and is set per request by the middleware.
    return [{ source: '/:path*', headers: staticSecurityHeaders() }];
  },
};

export default nextConfig;
