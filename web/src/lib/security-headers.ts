export type Header = { key: string; value: string };

/**
 * The CSP allows only this site and the company's Supabase project; inline scripts/styles are needed by
 * Next.js, eval only by the dev runtime. Set per request by the middleware (the project depends on the host).
 */
export function contentSecurityPolicy(supabaseUrl: string, dev: boolean): string {
  const supabase = new URL(supabaseUrl);
  return [
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
}

/** Headers that are the same for every company: applied to every route in next.config.ts. */
export function staticSecurityHeaders(): Header[] {
  return [
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ];
}

export function securityHeaders(supabaseUrl: string, dev: boolean): Header[] {
  return [{ key: 'Content-Security-Policy', value: contentSecurityPolicy(supabaseUrl, dev) }, ...staticSecurityHeaders()];
}
