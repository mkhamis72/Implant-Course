import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { canEdit } from '@/lib/auth/permissions';
import { ageOn } from '@/lib/patients/age';
import type { Patient } from '@/lib/patients/types';
import { PATIENT_FILTERS, PATIENT_FILTER_LABELS, SCAN_FILTERS, TOOTH_FILTERS, parseStages, teethByPatient, toothBoundFilters, type StageSite } from '@/lib/patients/stages';
import { firstParam, type PageSearchParams } from '@/lib/search-params';
import { idParam, supervisorChoices, type SupervisorRow } from '@/lib/patients/list-filters';
import { DeletePatient } from './delete-patient';
import { FilterMenu } from './filter-menu';
import { TeachingFilters } from './teaching-filters';
import { teachingOn } from '@/lib/modules/modules';
import { PAGE_SIZE, lastPage, pageSummary, parsePage } from '@/lib/patients/pages';
import { Pager } from './pager';

export default async function PatientsPage({ searchParams }: { searchParams: PageSearchParams }) {
  const profile = await requirePermission('patients');
  const editable = canEdit(profile, 'patients');
  const sp = await searchParams;
  const q = firstParam(sp.q);
  const archived = firstParam(sp.archived);
  const stages = parseStages(sp.stage);
  // A clinic (no Teaching) has no course or supervisor filter.
  const teaching = teachingOn(profile.features);
  const course = teaching ? idParam(firstParam(sp.course)) : '';
  const supervisor = teaching ? idParam(firstParam(sp.supervisor)) : '';
  const supabase = await createClient();
  const none = Promise.resolve({ data: [], error: null });
  const filter = { q, include_archived: archived === '1', stages, course: course || null, supervisor: supervisor || null };
  const pageOf = (n: number) => supabase.rpc('search_patients_v2', { ...filter, p_offset: (n - 1) * PAGE_SIZE, p_limit: PAGE_SIZE });
  let page = parsePage(sp.page);
  const [first, counted, courseRows, supervisorRows] = await Promise.all([
    pageOf(page),
    supabase.rpc('search_patients_count', filter),
    // course_options() needs View on Patients, like this page (the courses table needs Courses or Schedule).
    teaching ? supabase.rpc('course_options') : none,
    // Inactive supervisors too: past implants and bookings still name them.
    teaching ? supabase.from('supervisors').select('id, full_name, active') : none,
  ]);
  if (first.error || counted.error || courseRows.error || supervisorRows.error) throw new Error('Could not load patients');
  const total = Number(counted.data ?? 0);
  const last = lastPage(total);
  let search: Awaited<ReturnType<typeof pageOf>> = first;
  // A page past the end (a bookmark, or patients archived since) shows the last page.
  if (page > last) {
    page = last;
    search = await pageOf(page);
    if (search.error) throw new Error('Could not load patients');
  }
  const courses = (courseRows.data ?? []) as { id: string; name: string }[];
  const supervisors = supervisorChoices((supervisorRows.data ?? []) as SupervisorRow[]);
  const patients = (search.data ?? []) as Patient[];
  const teethStages = toothBoundFilters(stages);
  let teeth: Record<string, string> = {};
  if (teethStages.length && patients.length) {
    const ids = patients.map((p) => p.id);
    const toothStates = teethStages.filter((s) => TOOTH_FILTERS.includes(s));
    const [sites, states] = await Promise.all([
      supabase.rpc('implant_stage_sites', { p_patients: ids }),
      toothStates.length
        ? supabase.from('tooth_status').select('patient_id, tooth, status').in('patient_id', ids).in('status', toothStates)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (sites.error || states.error) throw new Error('Could not load the patients’ teeth');
    const stateRows = (states.data ?? []).map((r) => ({ patient_id: r.patient_id, tooth: r.tooth, stage: r.status }));
    teeth = teethByPatient([...((sites.data ?? []) as StageSite[]), ...stateRows], teethStages);
  }
  const today = new Date();

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1>Patients</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/patients/recall" className="btn-secondary btn">Recall list</Link>
          {editable && (
            <Link href="/patients/new" className="btn">
              New patient
            </Link>
          )}
        </div>
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
        <TeachingFilters teachingOn={teaching} courses={courses} supervisors={supervisors} course={course} supervisor={supervisor} />
        <FilterMenu label="Teeth and implants" name="stage" options={PATIENT_FILTERS} labels={PATIENT_FILTER_LABELS} checked={stages} />
        <FilterMenu label="Scan / impression" name="stage" options={SCAN_FILTERS} labels={PATIENT_FILTER_LABELS} checked={stages} align="end" />
        <button className="btn-secondary btn">Search</button>
      </form>
      <div className="card overflow-x-auto">
        {patients.length === 0 ? (
          <p className="text-muted">No patients found.</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted" data-testid="patient-count">{pageSummary(page, total)}</p>
            <table className="table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Name</th>
                  <th>Age</th>
                  <th>Phone</th>
                  {teethStages.length > 0 && <th>Teeth</th>}
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
                    {teethStages.length > 0 && <td data-label="Teeth">{teeth[p.id] ?? '—'}</td>}
                    <td data-label="Actions">
                      {editable && <DeletePatient id={p.id} name={p.full_name} triggerLabel={`Delete ${p.full_name}`} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager page={page} last={last} filters={{ q, archived: archived === '1' ? '1' : '', stages, course, supervisor }} />
          </>
        )}
      </div>
    </div>
  );
}
