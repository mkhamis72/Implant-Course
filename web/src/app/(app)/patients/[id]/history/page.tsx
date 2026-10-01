import { createClient } from '@/lib/supabase/server';
import { formatDateTime } from '@/lib/format';
import { describeChange } from '@/lib/patients/history';
import type { HistoryEntry } from '@/lib/patients/types';

export default async function HistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('patient_history', { p_patient: id });
  if (error) throw new Error('Could not load history');
  const entries = (data ?? []) as HistoryEntry[];

  return (
    <section className="card max-w-3xl">
      <h2 className="mb-4 font-semibold">Change history</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-gray-600">No changes recorded.</p>
      ) : (
        <ol className="divide-y divide-gray-100">
          {entries.map((entry) => (
            <li key={entry.id} data-testid="history-entry" className="flex flex-wrap gap-x-4 py-2 text-sm">
              <time dateTime={entry.at} className="w-40 shrink-0 text-gray-500">
                {formatDateTime(entry.at)}
              </time>
              <span className="w-40 shrink-0 text-gray-700">{entry.actor}</span>
              <span>{describeChange(entry)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
