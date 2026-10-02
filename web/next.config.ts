import type { NextConfig } from 'next';
import { securityHeaders } from './src/lib/security-headers';

const nextConfig: NextConfig = {
  // The dev badge sits over the nav's bottom-left Sign out button.
  devIndicators: false,
  async headers() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set (see .env.example)');
    return [{ source: '/:path*', headers: securityHeaders(supabaseUrl, process.env.NODE_ENV !== 'production') }];
  },
};

export default nextConfig;
