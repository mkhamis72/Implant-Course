import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireDelegate } from '@/lib/auth/session';
import { isRealDate, todayIso } from '@/lib/dates';
import { formatDate, formatTime } from '@/lib/format';
import { readParams, type PageSearchParams } from '@/lib/search-params';
import { weekOf } from '@/lib/delegate-portal/week';

type Item = {
  kind: 'surgery' | 'lecture' | 'workshop'; starts_at: string; ends_at: string; title: string; course: string;
  place: string | null; lead: string | null; my_role: 'placing' | 'assisting' | null;
  patient_name: string | null; file_no: string | null; teeth: string | null;
};

const KIND: Record<Item['kind'], { label: string; badge: string }> = {
  surgery: { label: 'Surgery', badge: 'badge-accent' },
  lecture: { label: 'Lecture', badge: 'badge-ok' },
  workshop: { label: 'Workshop', badge: 'badge-warn' },
};

/** Cairo calendar date of a timestamp. */
const dayOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(iso));

export default async function MySchedulePage({ searchParams }: { searchParams: PageSearchParams }) {
  const profile = await requireDelegate();
  const raw = (await readParams(searchParams, 'date')).date;
  const week = weekOf(raw && isRealDate(raw) ? raw : todayIso());
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('my_schedule', { p_from: week.from, p_to: week.to });
  if (error) throw new Error('Could not load your schedule');
  const items = (data ?? []) as Item[];
  const days = [...new Set(items.map((i) => dayOf(i.starts_at)))];

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div>
          <h1>My schedule</h1>
          <p className="text-muted">
            {profile.full_name} · {formatDate(week.from)} – {formatDate(week.to)}
          </p>
        </div>
      </div>
      <nav className="flex gap-4 text-sm" aria-label="Week">
        <Link href={`/my?date=${week.prev}`} className="text-accent hover:underline">← Previous week</Link>
        <Link href="/my" className="text-accent hover:underline">This week</Link>
        <Link href={`/my?date=${week.next}`} className="text-accent hover:underline">Next week →</Link>
      </nav>
      {items.length === 0 && <p className="card text-muted">Nothing scheduled this week.</p>}
      {days.map((day) => (
        <section key={day} className="card space-y-2">
          <h2 className="font-semibold">{formatDate(day)}</h2>
          <ul className="divide-y divide-line">
            {items
              .filter((i) => dayOf(i.starts_at) === day)
              .map((i) => (
                <li key={`${i.kind}-${i.starts_at}-${i.title}`} data-testid="my-item" className="flex flex-wrap items-start gap-x-6 gap-y-1 py-2 text-sm">
                  <span className="w-28 font-medium tabular-nums">{formatTime(i.starts_at)}–{formatTime(i.ends_at)}</span>
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={`badge ${KIND[i.kind].badge}`}>{KIND[i.kind].label}</span>
                      <span className="font-medium">{i.title}</span>
                    </span>
                    <span className="block text-muted">
                      {i.course}
                      {i.place && <> · {i.place}</>}
                      {i.lead && <> · {i.kind === 'surgery' ? 'Supervisor' : 'Lecturer'}: {i.lead}</>}
                    </span>
                    {i.kind === 'surgery' && (
                      <span className="block">
                        You: {i.my_role === 'placing' ? 'placing' : 'assisting'} · {i.patient_name} ({i.file_no})
                        {i.teeth && <> · teeth {i.teeth}</>}
                      </span>
                    )}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
