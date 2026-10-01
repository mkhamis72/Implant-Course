import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ageOn } from '@/lib/patients/age';
import { medicalAlerts } from '@/lib/patients/alerts';
import type { MedicalHistory, Patient } from '@/lib/patients/types';
import { PatientTabs } from './patient-tabs';

export default async function PatientLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const [{ data: patient }, { data: history }] = await Promise.all([
    supabase.from('patients').select('*').eq('id', id).maybeSingle(),
    supabase.from('medical_history').select('*').eq('patient_id', id).maybeSingle(),
  ]);
  if (!patient) notFound();
  const p = patient as Patient;
  const age = ageOn(p.dob, new Date());
  const alerts = medicalAlerts(history as MedicalHistory | null);

  return (
    <div className="space-y-4">
      <header data-testid="patient-header" className="card flex flex-wrap items-center gap-x-6 gap-y-2 py-4">
        <h1 className="text-2xl font-semibold">{p.full_name}</h1>
        <span className="text-sm text-gray-600">File {p.file_no}</span>
        {age !== null && <span className="text-sm text-gray-600">Age {age}</span>}
        {p.sex && <span className="text-sm capitalize text-gray-600">{p.sex}</span>}
        {p.archived && <span className="rounded bg-gray-100 px-2 py-0.5 text-sm text-gray-700">Archived</span>}
        {alerts.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Medical alerts">
            {alerts.map((alert) => (
              <li key={alert} data-testid="medical-alert" className="rounded bg-red-100 px-2 py-0.5 text-sm font-medium text-red-800">
                {alert}
              </li>
            ))}
          </ul>
        )}
      </header>
      <PatientTabs patientId={p.id} />
      {children}
    </div>
  );
}
