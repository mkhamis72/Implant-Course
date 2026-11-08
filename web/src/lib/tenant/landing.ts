import { normaliseHost } from './host';

/** The bare domain: every company is <name>.imploid.net, so this one belongs to none of them. */
const LANDING_HOSTS = new Set(['imploid.net', 'www.imploid.net']);

export function isLandingHost(raw: string | null | undefined): boolean {
  const host = normaliseHost(raw);
  return host !== null && LANDING_HOSTS.has(host);
}

/**
 * A plain page for the bare domain (also the Supabase Auth Site URL, the fallback no company owns). It names no
 * company, so it reveals nothing about who uses the service; no app shell, no Supabase call, nothing loaded.
 */
export function landingResponse(): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Implant Course Manager</title></head>`
    + `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#1f2933;line-height:1.5">`
    + `<h1 style="margin-bottom:.5rem">Implant Course Manager</h1>`
    + `<p>Patients, surgeries, stock and course reports for implant courses.</p>`
    + `<p>To sign in, open your organisation’s own address, for example <strong>yourcourse.imploid.net</strong>. Your course organiser can give you the link.</p>`
    + `</body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}
