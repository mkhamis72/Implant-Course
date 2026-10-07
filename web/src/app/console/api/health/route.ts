import { requireConsoleAdmin } from '@/lib/console/session';
import { createConsoleServiceClient } from '@/lib/console/supabase';
import { companyHealth } from '@/lib/console/companies';

// Same rule as the slug in the console schemas.
const SLUG = /^[a-z0-9-]{2,40}$/;

/** One company's health. A GET route (not a server action) so the rows' checks run in parallel. */
export async function GET(request: Request) {
  await requireConsoleAdmin();
  const slug = new URL(request.url).searchParams.get('slug') ?? '';
  if (!SLUG.test(slug)) return Response.json({ error: 'Bad slug' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  return Response.json(await companyHealth(createConsoleServiceClient(), slug), { headers: { 'Cache-Control': 'no-store' } });
}
