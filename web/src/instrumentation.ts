/**
 * Runs once when a server instance starts. In the Node.js runtime (pages, actions, route handlers and the
 * middleware) every console.error is also recorded in public.error_log for the hourly Error alert check
 * (src/lib/errors/report.ts; production only). waitUntil keeps the function alive until the error is sent.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const [{ installErrorReporting }, { waitUntil }] = await Promise.all([import('./lib/errors/report'), import('@vercel/functions')]);
  installErrorReporting({ waitUntil });
}
