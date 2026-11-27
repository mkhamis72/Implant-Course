import { unstable_rethrow } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth/session';
import { canView } from '@/lib/auth/permissions';
import { userMessage } from '@/lib/db-errors';
import { decodeBytea } from '@/lib/branding/image';
import { isUuid } from '@/lib/uuid';
import { passportFileName } from '@/lib/passport/labels';
import { attachmentDisposition } from '@/lib/passport/versions';

export const runtime = 'nodejs';

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
const notFound = () => text('Passport not found.', 404);

/**
 * A stored passport, byte for byte, as `Implant passport <file_no>-<version>.pdf` (View on Patients).
 * patient_passport_file logs the download. A passport not on this patient (or not readable) is 404.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; passportId: string }> }) {
  try {
    const profile = await getCurrentProfile();
    if (!profile?.active || profile.mfa_setup_required || !canView(profile, 'patients')) return notFound();
    const { id, passportId } = await params;
    if (!isUuid(id) || !isUuid(passportId)) return notFound();

    const supabase = await createClient();
    const [passport, patient] = await Promise.all([
      supabase.from('patient_passports').select('version').eq('id', passportId).eq('patient_id', id).maybeSingle<{ version: number }>(),
      supabase.from('patients').select('file_no').eq('id', id).maybeSingle<{ file_no: string }>(),
    ]);
    if (passport.error || patient.error) throw new Error((passport.error ?? patient.error)!.message);
    if (!passport.data || !patient.data) return notFound();

    const file = await supabase.rpc('patient_passport_file', { p_passport: passportId });
    if (file.error) {
      const message = userMessage(file.error);
      return text(message ?? 'Could not download the passport.', file.error.hint === 'user' ? 404 : 500);
    }
    if (typeof file.data !== 'string') return notFound();
    return new Response(Buffer.from(decodeBytea(file.data)), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': attachmentDisposition(passportFileName(patient.data.file_no, passport.data.version)),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    unstable_rethrow(e);
    console.error('Implant passport download failed', e instanceof Error ? e.message : 'unknown error');
    return text('Could not download the passport.', 500);
  }
}
