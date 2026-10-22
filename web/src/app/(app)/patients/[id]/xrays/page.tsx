import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { canEdit } from '@/lib/auth/permissions';
import type { Radiograph } from '@/lib/radiographs/radiographs';
import { XrayList } from './xray-list';
import type { XraySite } from './radiograph-form';

export default async function XraysPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requirePermission('patients');
  const { id } = await params;
  const supabase = await createClient();
  const [xrays, sites] = await Promise.all([
    supabase.rpc('radiographs_for', { p_patient: id }),
    supabase.from('implant_sites').select('id, tooth, state, placed_on').eq('patient_id', id),
  ]);
  if (xrays.error || sites.error) throw new Error('Could not load X-rays');

  return (
    <section className="space-y-3">
      <h2 className="font-semibold">X-rays</h2>
      <XrayList
        patientId={id}
        radiographs={(xrays.data ?? []) as unknown as Radiograph[]}
        sites={(sites.data ?? []) as XraySite[]}
        editable={canEdit(profile, 'patients')}
      />
    </section>
  );
}
