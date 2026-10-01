import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { DelegateForm, type DelegateRow } from './delegate-form';
import { createDelegate } from './actions';

export default async function DelegatesPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('delegates')
    .select('id, full_name, phone, email, licence_no, notes, active')
    .order('active', { ascending: false })
    .order('full_name');
  if (error) throw new Error('Could not load delegates');
  const delegates = (data ?? []) as DelegateRow[];
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Delegates</h1>
      <section className="space-y-2">
        <h2 className="font-semibold">Add a delegate</h2>
        <DelegateForm action={createDelegate} />
      </section>
      <div className="card overflow-x-auto">
        {delegates.length === 0 ? (
          <p className="text-gray-600">No delegates yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-gray-500">
                <th className="pb-2">Name</th>
                <th className="pb-2">Licence</th>
                <th className="pb-2">Phone</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {delegates.map((d) => (
                <tr key={d.id} data-testid={`delegate-row-${d.full_name}`} className="border-t border-gray-200">
                  <td className="py-2 pr-4">
                    <Link href={`/delegates/${d.id}`} className="text-blue-700 hover:underline">
                      {d.full_name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{d.licence_no || '—'}</td>
                  <td className="py-2 pr-4">{d.phone || '—'}</td>
                  <td className="py-2">{d.active ? 'Active' : 'Inactive'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
