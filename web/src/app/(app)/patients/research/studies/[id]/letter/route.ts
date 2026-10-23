import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth/session';
import { canView } from '@/lib/auth/permissions';
import { decodeBytea } from '@/lib/branding/image';

const notFound = () => new Response(null, { status: 404 });
const uuid = z.string().uuid();

/**
 * A study's approval letter. Without Research view and Patients view, or for a study without a letter, it is 404
 * (study_letter returns no row); never cached, never sniffed as another type.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const profile = await getCurrentProfile();
    if (!profile?.active || !canView(profile, 'research') || !canView(profile, 'patients')) return notFound();
    if (!uuid.safeParse(id).success) return notFound();

    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc('study_letter', { p_study: id })
      .maybeSingle<{ bytes: string; content_type: string }>();
    if (error || !data) return notFound();
    return new Response(Buffer.from(decodeBytea(data.bytes)), {
      headers: {
        'Content-Type': data.content_type,
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    unstable_rethrow(e);
    return notFound();
  }
}
