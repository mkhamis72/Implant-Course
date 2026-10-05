import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { canEdit } from '@/lib/auth/permissions';
import { DelegateForm, type DelegateRow } from './delegate-form';
import { createDelegate } from './actions';

export default async function DelegatesPage() {
  const profile = await requirePermission('delegates');
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
      <h1>Delegates</h1>
      {canEdit(profile, 'delegates') && (
        <section className="space-y-2">
          <h2 className="font-semibold">Add a delegate</h2>
          <DelegateForm action={createDelegate} />
        </section>
      )}
      <div className="card overflow-x-auto">
        {delegates.length === 0 ? (
          <p className="text-muted">No delegates yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Licence</th>
                <th>Phone</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {delegates.map((d) => (
                <tr key={d.id} data-testid={`delegate-row-${d.full_name}`}>
                  <td data-label="Name">
                    <Link href={`/delegates/${d.id}`} className="text-accent hover:underline">
                      {d.full_name}
                    </Link>
                  </td>
                  <td data-label="Licence">{d.licence_no || '—'}</td>
                  <td data-label="Phone">{d.phone || '—'}</td>
                  <td data-label="Status">{d.active ? 'Active' : 'Inactive'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
