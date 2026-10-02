export type Header = { key: string; value: string };

/**
 * Response headers for every route. The CSP allows only this site and the Supabase project;
 * inline scripts/styles are needed by Next.js, eval only by the dev runtime.
 */
export function securityHeaders(supabaseUrl: string, dev: boolean): Header[] {
  const supabase = new URL(supabaseUrl);
  const csp = [
    "default-src 'self'",
    `connect-src 'self' ${supabase.origin} wss://${supabase.host}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ];
}
