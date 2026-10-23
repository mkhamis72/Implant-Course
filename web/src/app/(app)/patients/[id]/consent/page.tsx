import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { canEdit } from '@/lib/auth/permissions';
import { todayIso } from '@/lib/dates';
import type { ConsentRecord, ConsentVersionOption } from '@/lib/consent/labels';
import { ConsentList } from './consent-list';
import { ConsentForm } from './consent-form';

export default async function ConsentPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requirePermission('patients');
  const { id } = await params;
  const editable = canEdit(profile, 'patients');
  const supabase = await createClient();
  const [records, versions, current] = await Promise.all([
    supabase.rpc('patient_consents_for', { p_patient: id }),
    editable ? supabase.rpc('consent_versions') : Promise.resolve({ data: [], error: null }),
    editable ? supabase.rpc('current_consent_version').maybeSingle<{ id: string }>() : Promise.resolve({ data: null, error: null }),
  ]);
  if (records.error || versions.error || current.error) throw new Error('Could not load consent');
  // Only versions already in effect can have been signed (the date signed is today or earlier).
  const today = todayIso();
  const signable = ((versions.data ?? []) as ConsentVersionOption[]).filter((v) => v.effective_on <= today);

  return (
    <section className="space-y-4">
      <h2 className="font-semibold">Consent</h2>
      <ConsentList patientId={id} records={(records.data ?? []) as ConsentRecord[]} editable={editable} />
      {editable && (
        <div className="space-y-2">
          <h3 className="font-semibold">Record signed consent</h3>
          <ConsentForm patientId={id} versions={signable} currentVersionId={current.data?.id ?? null} />
        </div>
      )}
    </section>
  );
}
