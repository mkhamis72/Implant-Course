export type Header = { key: string; value: string };

/**
 * The CSP allows only this site and the company's Supabase project; inline scripts/styles are needed by
 * Next.js, eval only by the dev runtime. Set per request by the middleware (the project depends on the host).
 * The Implant Passport is drawn in the browser by react-pdf, whose layout engine (yoga) is WebAssembly embedded as a
 * data: URL and fetched: 'wasm-unsafe-eval' lets the page compile its own WebAssembly (no eval of JavaScript, no
 * remote code) and connect-src data: lets it fetch that embedded module.
 */
export function contentSecurityPolicy(supabaseUrl: string, dev: boolean): string {
  const supabase = new URL(supabaseUrl);
  // Dev-only allowance so the impeccable live design helper (localhost:8400) can load. Never in production.
  const liveDev = dev ? ' http://localhost:8400' : '';
  return [
    "default-src 'self'",
    `connect-src 'self' ${supabase.origin} ${supabase.protocol === 'http:' ? 'ws' : 'wss'}://${supabase.host} data:${liveDev}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ''}${liveDev}`,
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
