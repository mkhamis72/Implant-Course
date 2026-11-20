import Link from 'next/link';
import { redirect } from 'next/navigation';
import { featureOn } from '@/lib/modules/modules';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { isRealDate, todayIso } from '@/lib/dates';
import { formatDate } from '@/lib/format';
import type { PullRow } from '@/lib/schedule/types';
import { PrintButton } from './print-button';
import { PullTable } from './pull-table';
import { readParams, type PageSearchParams } from '@/lib/search-params';

export default async function PullListPage({ searchParams }: { searchParams: PageSearchParams }) {
  const profile = await requirePermission('schedule');
  if (!featureOn(profile.features, 'inventory')) redirect('/schedule');
  const raw = (await readParams(searchParams, 'date')).date || undefined;
  const date = raw && isRealDate(String(raw)) ? String(raw) : todayIso();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('pull_list_v2', { p_date: date });
  if (error) throw new Error('Could not load the pull list');
  const rows = (data ?? []) as PullRow[];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1>Pull list · {formatDate(date)}</h1>
        <Link href={`/schedule?date=${date}`} className="text-accent hover:underline print:hidden">Back to schedule</Link>
        <PrintButton />
      </div>
      <div className="card">
        {rows.length === 0 ? (
          <p className="text-muted">No planned implants on this day.</p>
        ) : (
          <PullTable rows={rows} />
        )}
      </div>
    </div>
  );
}
