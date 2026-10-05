import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { canEdit } from '@/lib/auth/permissions';
import type { MedicalHistory, Patient } from '@/lib/patients/types';
import { PatientForm } from '../../new/patient-form';
import { updatePatient } from '../../actions';
import { MedicalHistoryForm } from './medical-history-form';
import { ArchiveButton } from './archive-button';

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requirePermission('patients');
  const editable = canEdit(profile, 'patients');
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: patient }, { data: history }] = await Promise.all([
    supabase.from('patients').select('*').eq('id', id).maybeSingle(),
    supabase.from('medical_history').select('*').eq('patient_id', id).maybeSingle(),
  ]);
  if (!patient || !history) notFound();
  const p = patient as Patient;
  return (
    // Viewers see the same forms, disabled: every field stays readable without a second layout.
    <fieldset disabled={!editable} className="min-w-0 space-y-6">
      <section className="space-y-2">
        <h2 className="font-semibold">Details</h2>
        <PatientForm action={updatePatient} patient={p} />
      </section>
      <MedicalHistoryForm history={history as MedicalHistory} />
      {editable && <ArchiveButton patientId={p.id} archived={p.archived} />}
    </fieldset>
  );
}
