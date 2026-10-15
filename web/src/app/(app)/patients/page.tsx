import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { canEdit } from '@/lib/auth/permissions';
import { ageOn } from '@/lib/patients/age';
import type { Patient } from '@/lib/patients/types';
import { PATIENT_FILTERS, PATIENT_FILTER_LABELS, TOOTH_FILTERS, parseStages, teethByPatient, type StageSite } from '@/lib/patients/stages';
import { firstParam, type PageSearchParams } from '@/lib/search-params';
import { DeletePatient } from './delete-patient';

export default async function PatientsPage({ searchParams }: { searchParams: PageSearchParams }) {
  const profile = await requirePermission('patients');
  const editable = canEdit(profile, 'patients');
  const sp = await searchParams;
  const q = firstParam(sp.q);
  const archived = firstParam(sp.archived);
  const stages = parseStages(sp.stage);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('search_patients', { q, include_archived: archived === '1', stages });
  if (error) throw new Error('Could not load patients');
  // The search returns one row more than it shows, to tell whether there are more.
  const rows = (data ?? []) as Patient[];
  const patients = rows.slice(0, 50);
  let teeth: Record<string, string> = {};
  if (stages.length && patients.length) {
    const ids = patients.map((p) => p.id);
    const toothStates = stages.filter((s) => TOOTH_FILTERS.includes(s));
    const [sites, states] = await Promise.all([
      supabase.rpc('implant_stage_sites', { p_patients: ids }),
      toothStates.length
        ? supabase.from('tooth_status').select('patient_id, tooth, status').in('patient_id', ids).in('status', toothStates)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (sites.error || states.error) throw new Error('Could not load the patients’ teeth');
    const stateRows = (states.data ?? []).map((r) => ({ patient_id: r.patient_id, tooth: r.tooth, stage: r.status }));
    teeth = teethByPatient([...((sites.data ?? []) as StageSite[]), ...stateRows], stages);
  }
  const today = new Date();

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1>Patients</h1>
        {editable && (
          <Link href="/patients/new" className="btn">
            New patient
          </Link>
        )}
      </div>
      <form className="card flex flex-wrap items-end gap-4" role="search">
        <label className="block min-w-64 flex-1">
          <span className="label">Search patients</span>
          <input className="input" name="q" defaultValue={q} placeholder="Name, file number or phone" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="archived" value="1" defaultChecked={archived === '1'} />
          Include archived
        </label>
        <fieldset className="basis-full">
          <legend className="label">Teeth and implants</legend>
          <div className="flex flex-wrap gap-2">
            {PATIENT_FILTERS.map((s) => (
              <label
                key={s}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-sm hover:bg-sunken has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
              >
                <input type="checkbox" name="stage" value={s} defaultChecked={stages.includes(s)} />
                {PATIENT_FILTER_LABELS[s]}
              </label>
            ))}
          </div>
        </fieldset>
        <button className="btn-secondary btn">Search</button>
      </form>
      <div className="card overflow-x-auto">
        {patients.length === 0 ? (
          <p className="text-muted">No patients found.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>File</th>
                <th>Name</th>
                <th>Age</th>
                <th>Phone</th>
                {stages.length > 0 && <th>Teeth</th>}
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <tr key={p.id} data-testid={`patient-row-${p.file_no}`}>
                  <td data-label="File">{p.file_no}</td>
                  <td data-label="Name">
                    <Link href={`/patients/${p.id}`} className="text-accent hover:underline">
                      {p.full_name}
                    </Link>
                    {p.archived && <span className="ml-2 badge">Archived</span>}
                  </td>
                  <td data-label="Age">{ageOn(p.dob, today) ?? '—'}</td>
                  <td data-label="Phone">{p.phone || '—'}</td>
                  {stages.length > 0 && <td data-label="Teeth">{teeth[p.id] ?? '—'}</td>}
                  <td data-label="Actions">
                    {editable && <DeletePatient id={p.id} name={p.full_name} triggerLabel={`Delete ${p.full_name}`} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rows.length > patients.length && (
          <p data-testid="search-capped" className="mt-3 text-sm text-muted">Showing the first 50 — refine your search.</p>
        )}
      </div>
    </div>
  );
}
