import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getSettings, requireActiveUser } from '@/lib/auth/session';
import { addDays, todayIso } from '@/lib/dates';
import { formatDate, formatTime } from '@/lib/format';
import { productLabel } from '@/lib/inventory/labels';
import { stockFlags } from '@/lib/inventory/lots';
import type { Product } from '@/lib/inventory/types';
import { SLOT_SELECT } from '@/lib/schedule/queries';
import { groupByChair } from '@/lib/dashboard/by-chair';
import type { PullRow, SlotRow } from '@/lib/schedule/types';
import { dashboardShortages } from '@/lib/dashboard/shortages';

type StockRow = Product & { on_hand: number; nearest_expiry: string | null };

/** A failed query must never look like an empty (all-clear) card. */
const COUNT = { bad: 'badge-bad', warn: 'badge-warn', accent: 'badge-accent' } as const;

/**
 * A card only shows a coloured count when it holds something to act on,
 * so an all-clear dashboard stays calm and a problem stands out.
 */
function Card({ title, failed, count = 0, tone, className = '', children }: {
  title: string; failed?: boolean; count?: number; tone?: keyof typeof COUNT; className?: string; children: React.ReactNode;
}) {
  const flagged = !failed && count > 0 && tone;
  return (
    <section className={`card space-y-3 ${className}`}>
      <h2 className="flex items-center gap-2 font-semibold">
        {title}
        {flagged && <span className={`badge ${COUNT[tone]}`}>{count}</span>}
      </h2>
      {failed ? (
        <p role="alert" className="text-sm text-bad">Could not load this. Reload the page to try again.</p>
      ) : (
        children
      )}
    </section>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();
  // Pages render alongside the layout, so check the account here too before reading settings.
  const profile = await requireActiveUser();
  const settings = await getSettings();
  const today = todayIso();
  const tomorrow = addDays(today, 1);
  const [slots, pullToday, pullTomorrow, stock, mine] = await Promise.all([
    supabase.rpc('slots_on', { p_date: today }).select(SLOT_SELECT),
    supabase.rpc('pull_list', { p_date: today }),
    supabase.rpc('pull_list', { p_date: tomorrow }),
    supabase.rpc('inventory_overview', { q: '', p_category: '', include_all: false }),
    supabase
      .from('checklist_items')
      .select('id, text, due_date, checklist:checklists(id, title)')
      .eq('assignee_id', profile.user_id)
      .is('done_at', null)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(20),
  ]);

  const surgeries = ((slots.data ?? []) as unknown as SlotRow[]).filter((s) => s.status !== 'cancelled');
  const byChair = groupByChair(surgeries);
  const shortages = dashboardShortages((pullToday.data ?? []) as PullRow[], (pullTomorrow.data ?? []) as PullRow[]);
  const stockRows = (stock.data ?? []) as StockRow[];
  const flagged = stockRows.map((r) => ({ r, f: stockFlags(r, today, settings.expiry_alert_days) }));
  const low = flagged.filter((x) => x.f.low).map((x) => x.r);
  const expiring = flagged.filter((x) => x.f.expiring).map((x) => x.r);
  const myItems = (mine.data ?? []) as unknown as { id: string; text: string; due_date: string | null; checklist: { id: string; title: string } }[];

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="text-muted">Welcome, {profile.full_name || profile.email} · {formatDate(today)}</p>
        </div>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card title="Today's surgeries" failed={Boolean(slots.error)} count={surgeries.length} tone="accent" className="lg:col-span-2">
          {surgeries.length === 0 ? (
            <p className="text-sm text-muted">No surgeries booked today.</p>
          ) : (
            <ul className="grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
              {byChair.map((g) => (
                <li key={g.chair} data-testid="dash-chair" className="space-y-1.5">
                  <h3 className="font-semibold text-ink">{g.chair}</h3>
                  <ul className="space-y-1.5">
              {g.slots.map((s) => (
                <li
                  key={s.id}
                  data-testid="dash-surgery"
                  className="flex flex-wrap items-baseline gap-x-3 py-0.5"
                >
                  <span className="font-semibold">{formatTime(s.starts_at)}–{formatTime(s.ends_at)}</span>
                  {s.patient && (
                    <Link href={`/patients/${s.patient.id}`} className="text-accent hover:underline">{s.patient.full_name}</Link>
                  )}
                  {s.implants.length > 0 && <span className="text-muted">teeth {s.implants.map((i) => i.tooth).join(', ')}</span>}
                  {s.status === 'done' && <span className="badge badge-ok">done</span>}
                </li>
              ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          <Link href={`/schedule?date=${today}`} className="text-sm text-accent hover:underline">Open today’s schedule</Link>
        </Card>

        <Card title="Stock shortages for surgeries" failed={Boolean(pullToday.error || pullTomorrow.error)} count={shortages.length} tone="bad">
          {shortages.length === 0 ? (
            <p className="text-sm text-muted">Stock covers today’s and tomorrow’s planned implants.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {shortages.map((r) => (
                <li key={`${r.day}-${r.product_id}`} data-testid="dash-shortage" className="flex flex-wrap gap-x-4 py-1.5">
                  <span className="font-medium">{r.day}</span>
                  <span>{productLabel(r)}</span>
                  <span className="badge badge-bad">need {r.needed}, have {r.available}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Low stock" failed={Boolean(stock.error)} count={low.length} tone="warn">
          {low.length === 0 ? (
            <p className="text-sm text-muted">Nothing is at or below its reorder level.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {low.map((r) => (
                <li key={r.id} data-testid="dash-low" className="flex flex-wrap gap-x-4 py-1.5">
                  <Link href={`/inventory/products/${r.id}`} className="text-accent hover:underline">{productLabel(r)}</Link>
                  <span>{r.on_hand} left (reorder at {r.reorder_level})</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Expiring soon" failed={Boolean(stock.error)} count={expiring.length} tone="warn">
          {expiring.length === 0 ? (
            <p className="text-sm text-muted">Nothing expires in the next {settings.expiry_alert_days} days.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {expiring.map((r) => (
                <li key={r.id} data-testid="dash-expiring" className="flex flex-wrap gap-x-4 py-1.5">
                  <Link href={`/inventory/products/${r.id}`} className="text-accent hover:underline">{productLabel(r)}</Link>
                  <span>{r.nearest_expiry ? `expires ${formatDate(r.nearest_expiry)}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="My open checklist items" failed={Boolean(mine.error)} count={myItems.length} tone="accent">
          {myItems.length === 0 ? (
            <p className="text-sm text-muted">Nothing assigned to you is open.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {myItems.map((i) => (
                <li key={i.id} data-testid="dash-my-item" className="flex flex-wrap gap-x-4 py-1.5">
                  <span className="font-medium">{i.text}</span>
                  <Link href={`/checklists/${i.checklist.id}`} className="text-accent hover:underline">{i.checklist.title}</Link>
                  {i.due_date && <span className="text-muted">due {formatDate(i.due_date)}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
