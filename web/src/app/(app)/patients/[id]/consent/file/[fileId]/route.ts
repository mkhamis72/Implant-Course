import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth/session';
import { canView } from '@/lib/auth/permissions';
import { decodeBytea } from '@/lib/branding/image';

const notFound = () => new Response(null, { status: 404 });
const uuid = z.string().uuid();

/**
 * The signed scan of one of this patient's consent records. Without View on Patients, or for a file that isn't on
 * that patient's consent, it is 404 (consent_file returns no row); never cached, never sniffed as another type.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  try {
    const { id, fileId } = await params;
    const profile = await getCurrentProfile();
    if (!profile?.active || profile.mfa_setup_required || !canView(profile, 'patients')) return notFound();
    if (!uuid.safeParse(id).success || !uuid.safeParse(fileId).success) return notFound();

    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc('consent_file', { p_patient: id, p_file: fileId })
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
