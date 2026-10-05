import { requirePermission } from '@/lib/auth/session';
import { PatientForm } from './patient-form';
import { createPatient } from '../actions';

export default async function NewPatientPage() {
  await requirePermission('patients', 'edit');
  return (
    <div className="space-y-6">
      <h1>New patient</h1>
      <PatientForm action={createPatient} />
    </div>
  );
}
