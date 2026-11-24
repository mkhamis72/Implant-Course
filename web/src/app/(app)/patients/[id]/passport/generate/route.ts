import { unstable_rethrow } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth/session';
import { canEdit } from '@/lib/auth/permissions';
import { userMessage } from '@/lib/db-errors';
import { encodeBytea } from '@/lib/branding/image';
import { isUuid } from '@/lib/uuid';
import { loadPassportData } from '@/lib/passport/load';
import { passportModel } from '@/lib/passport/model';
import { renderPassport } from '@/lib/passport/render';

// react-pdf and the bundled fonts (read from disk) need Node.
export const runtime = 'nodejs';

const reply = (body: object, status: number) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * Route handlers get no server-action origin check, and every company's address is the same site (one parent
 * domain, so the Lax session cookie is sent): a POST must come from a page on this very address.
 */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Generates the patient's next Implant Passport (Edit on Patients): load with the user's own client (RLS) → model
 * → PDF → save_patient_passport. Answers JSON for the page's Generate button: { ok, version } or { error }.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(req)) return reply({ error: 'Not allowed.' }, 403);
    const profile = await getCurrentProfile();
    if (!profile?.active || profile.mfa_setup_required || !canEdit(profile, 'patients')) {
      return reply({ error: 'You are not allowed to generate passports.' }, 403);
    }
    const { id } = await params;
    if (!isUuid(id)) return reply({ error: 'Patient not found.' }, 404);

    const supabase = await createClient();
    const data = await loadPassportData(id);
    // The version printed on the passport; save_patient_passport assigns the stored one under the patient lock.
    const latest = await supabase.from('patient_passports').select('version').eq('patient_id', id)
      .order('version', { ascending: false }).limit(1).maybeSingle<{ version: number }>();
    if (latest.error) throw new Error(latest.error.message);
    const version = (latest.data?.version ?? 0) + 1;

    const pdf = await renderPassport(passportModel(data, new Date().toISOString(), version));
    const saved = await supabase.rpc('save_patient_passport', {
      p_patient: id, p_file: encodeBytea(pdf), p_medical_level: data.medicalLevel,
    });
    if (saved.error) return reply({ error: userMessage(saved.error) }, 400);

    const stored = await supabase.from('patient_passports').select('version').eq('id', saved.data as string)
      .maybeSingle<{ version: number }>();
    const storedVersion = stored.data?.version ?? version;
    // Only two generations at the same instant can get here; the printed number then differs from the stored one.
    if (storedVersion !== version) console.error('Implant passport saved under another version than printed', version, storedVersion);
    return reply({ ok: true, version: storedVersion }, 200);
  } catch (e) {
    unstable_rethrow(e);
    console.error('Implant passport generation failed', e instanceof Error ? e.message : 'unknown error');
    return reply({ error: 'Could not generate the passport. Please try again.' }, 500);
  }
}
