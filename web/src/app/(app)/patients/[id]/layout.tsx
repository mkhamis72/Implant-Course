import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { canEdit } from '@/lib/auth/permissions';
import { ageOn } from '@/lib/patients/age';
import { medicalAlerts } from '@/lib/patients/alerts';
import type { MedicalHistory, Patient } from '@/lib/patients/types';
import { ConsentBadge } from './consent-badge';
import { PatientTabs } from './patient-tabs';
import { DeletePatient } from '../delete-patient';

export default async function PatientLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requirePermission('patients');
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const [{ data: patient }, { data: history }, consents] = await Promise.all([
    supabase.from('patients').select('*').eq('id', id).maybeSingle(),
    supabase.from('medical_history').select('*').eq('patient_id', id).maybeSingle(),
    supabase.rpc('patient_consents_for', { p_patient: id }),
  ]);
  if (!patient) notFound();
  const p = patient as Patient;
  const age = ageOn(p.dob, new Date());
  // On a read error the badge stays hidden rather than claiming there is no consent.
  const hasConsent = Boolean(consents.error) || ((consents.data ?? []) as { is_current: boolean }[]).some((c) => c.is_current);
  const alerts = medicalAlerts(history as MedicalHistory | null);

  return (
    <div className="space-y-4">
      <header data-testid="patient-header" className="card flex flex-wrap items-center gap-x-6 gap-y-2 py-4 print:hidden">
        <h1>{p.full_name}</h1>
        <span className="text-sm text-muted">File {p.file_no}</span>
        {age !== null && <span className="text-sm text-muted">Age {age}</span>}
        {p.sex && <span className="text-sm capitalize text-muted">{p.sex}</span>}
        {p.archived && <span className="rounded bg-sunken px-2 py-0.5 text-sm text-ink">Archived</span>}
        <ConsentBadge patientId={p.id} hasCurrent={hasConsent} />
        {alerts.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Medical alerts">
            {alerts.map((alert) => (
              <li key={alert} data-testid="medical-alert" className="rounded bg-bad-soft px-2 py-0.5 text-sm font-medium text-bad">
                {alert}
              </li>
            ))}
          </ul>
        )}
        {canEdit(profile, 'patients') && <DeletePatient id={p.id} name={p.full_name} triggerClassName="ml-auto" panelClassName="basis-full" />}
      </header>
      <PatientTabs patientId={p.id} />
      {children}
    </div>
  );
}
