import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { ageOn } from '@/lib/patients/age';
import type { Patient } from '@/lib/patients/types';
import { readParams, type PageSearchParams } from '@/lib/search-params';

export default async function PatientsPage({ searchParams }: { searchParams: PageSearchParams }) {
  const { q, archived } = await readParams(searchParams, 'q', 'archived');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('search_patients', { q, include_archived: archived === '1' });
  if (error) throw new Error('Could not load patients');
  // The search returns one row more than it shows, to tell whether there are more.
  const rows = (data ?? []) as Patient[];
  const patients = rows.slice(0, 50);
  const today = new Date();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Patients</h1>
        <Link href="/patients/new" className="btn">
          New patient
        </Link>
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
        <button className="btn-secondary btn">Search</button>
      </form>
      <div className="card overflow-x-auto">
        {patients.length === 0 ? (
          <p className="text-gray-600">No patients found.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-gray-500">
                <th className="pb-2">File</th>
                <th className="pb-2">Name</th>
                <th className="pb-2">Age</th>
                <th className="pb-2">Phone</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <tr key={p.id} data-testid={`patient-row-${p.file_no}`} className="border-t border-gray-200">
                  <td className="py-2 pr-4">{p.file_no}</td>
                  <td className="py-2 pr-4">
                    <Link href={`/patients/${p.id}`} className="text-blue-700 hover:underline">
                      {p.full_name}
                    </Link>
                    {p.archived && <span className="ml-2 rounded bg-gray-100 px-1.5 text-xs text-gray-600">Archived</span>}
                  </td>
                  <td className="py-2 pr-4">{ageOn(p.dob, today) ?? '—'}</td>
                  <td className="py-2">{p.phone || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rows.length > patients.length && (
          <p data-testid="search-capped" className="mt-3 text-sm text-gray-600">Showing the first 50 — refine your search.</p>
        )}
      </div>
    </div>
  );
}
