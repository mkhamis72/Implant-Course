import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { MedicalHistory, Patient } from '@/lib/patients/types';
import { PatientForm } from '../../new/patient-form';
import { deletePatient, updatePatient } from '../../actions';
import { ConfirmDelete } from '@/components/confirm-delete';
import { MedicalHistoryForm } from './medical-history-form';
import { ArchiveButton } from './archive-button';

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: patient }, { data: history }] = await Promise.all([
    supabase.from('patients').select('*').eq('id', id).maybeSingle(),
    supabase.from('medical_history').select('*').eq('patient_id', id).maybeSingle(),
  ]);
  if (!patient || !history) notFound();
  const p = patient as Patient;
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="font-semibold">Details</h2>
        <PatientForm action={updatePatient} patient={p} />
      </section>
      <MedicalHistoryForm history={history as MedicalHistory} />
      <ArchiveButton patientId={p.id} archived={p.archived} />
      <ConfirmDelete
        id={p.id}
        noun="patient"
        name={p.full_name}
        consequences="Their chart, plans, notes and surgery bookings are deleted too. A patient with a placed implant or fitted component can't be deleted — archive them instead."
        action={deletePatient}
      />
    </div>
  );
}
