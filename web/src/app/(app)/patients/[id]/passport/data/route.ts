import { unstable_rethrow } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth/session';
import { canView } from '@/lib/auth/permissions';
import { userMessage } from '@/lib/db-errors';
import { todayIso } from '@/lib/dates';
import { isUuid } from '@/lib/uuid';
import { loadPassportData } from '@/lib/passport/load';
import { passportModel } from '@/lib/passport/model';
import { passportFileName } from '@/lib/passport/labels';

const reply = (body: object, status: number) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const notFound = () => reply({ error: 'Patient not found.' }, 404);

/**
 * Route handlers get no server-action origin check, and every company's address is the same site (one parent
 * domain, so the Lax session cookie is sent): the request must come from a page on this very address. Browsers mark
 * a same-origin fetch with Sec-Fetch-Site (a GET carries no Origin); an Origin, when sent, must be this host.
 */
function sameOrigin(req: Request): boolean {
  const host = req.headers.get('host');
  const origin = req.headers.get('origin');
  const site = req.headers.get('sec-fetch-site');
  if (!host) return false;
  if (origin) {
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
    return site === null || site === 'same-origin';
  }
  return site === 'same-origin';
}

/**
 * The patient's Implant Passport model for the browser to draw (View on Patients): load with the user's own client
 * (RLS; the medical whitelist stays here) → log_passport_generation → model. JSON `{ passport, fileName }` or
 * `{ error }`. The log means "passport data handed out": a failed download in the browser still leaves the row.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(req)) return reply({ error: 'Not allowed.' }, 403);
    const profile = await getCurrentProfile();
    if (!profile?.active || profile.mfa_setup_required || !canView(profile, 'patients')) return notFound();
    const { id } = await params;
    if (!isUuid(id)) return notFound();

    const data = await loadPassportData(id);
    if (!data) return notFound();
    const supabase = await createClient();
    const logged = await supabase.rpc('log_passport_generation', { p_patient: id, p_medical_level: data.medicalLevel });
    if (logged.error) return reply({ error: userMessage(logged.error) ?? 'Could not prepare the passport. Please try again.' }, 400);

    // The number printed (<file_no>-<n>) is this patient's generation count, this one included.
    const generations = await supabase.from('passport_generations').select('id', { count: 'exact', head: true }).eq('patient_id', id);
    if (generations.error) throw new Error(generations.error.message);
    const passport = passportModel(data, new Date().toISOString(), Math.max(1, generations.count ?? 1));
    return reply({ passport, fileName: passportFileName(data.patient.file_no, todayIso()) }, 200);
  } catch (e) {
    unstable_rethrow(e);
    console.error('Implant passport data failed', e instanceof Error ? e.message : 'unknown error');
    return reply({ error: 'Could not prepare the passport. Please try again.' }, 500);
  }
}
