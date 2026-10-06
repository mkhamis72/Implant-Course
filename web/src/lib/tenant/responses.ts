import { TENANT_HEADER } from './types';

/** Request headers to forward: whatever the browser sent as x-tenant is replaced by the routed company. */
export function forwardHeaders(incoming: Headers, slug: string): Headers {
  const headers = new Headers(incoming);
  headers.delete(TENANT_HEADER);
  headers.set(TENANT_HEADER, slug);
  return headers;
}

const PAGES = {
  'not-found': { status: 404, title: 'Not found', body: 'There is no site at this address.' },
  suspended: { status: 503, title: 'This site is temporarily unavailable', body: 'Please try again later or contact your course organizer.' },
  unavailable: { status: 503, title: 'Service unavailable', body: 'Please try again in a few minutes.' },
} as const;

/** Plain pages for requests that don't reach a company: no app shell, no Supabase call, nothing about other companies. */
export function blockedResponse(kind: keyof typeof PAGES): Response {
  const p = PAGES[kind];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${p.title}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem"><h1>${p.title}</h1><p>${p.body}</p></body></html>`;
  return new Response(html, { status: p.status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
