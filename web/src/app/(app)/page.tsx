import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getSettings, requireActiveUser } from '@/lib/auth/session';
import { addDays, todayIso } from '@/lib/dates';
import { formatDate, formatTime } from '@/lib/format';
import { productLabel } from '@/lib/inventory/labels';
import { stockFlags } from '@/lib/inventory/lots';
import type { Product } from '@/lib/inventory/types';
import { SLOT_SELECT } from '@/lib/schedule/queries';
import type { PullRow, SlotRow } from '@/lib/schedule/types';

type StockRow = Product & { on_hand: number; nearest_expiry: string | null };

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-2">
      <h2 className="font-semibold">{title}</h2>
      {children}
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
  const { data: chairs } = await supabase.from('chairs').select('id, name');
  const chairName = new Map((chairs ?? []).map((c) => [c.id as string, c.name as string]));
  const shortages = [
    ...((pullToday.data ?? []) as PullRow[]).map((r) => ({ ...r, day: 'Today' })),
    ...((pullTomorrow.data ?? []) as PullRow[]).map((r) => ({ ...r, day: 'Tomorrow' })),
  ].filter((r) => r.product_id && r.needed > r.available);
  const stockRows = (stock.data ?? []) as StockRow[];
  const flagged = stockRows.map((r) => ({ r, f: stockFlags(r, today, settings.expiry_alert_days) }));
  const low = flagged.filter((x) => x.f.low).map((x) => x.r);
  const expiring = flagged.filter((x) => x.f.expiring).map((x) => x.r);
  const myItems = (mine.data ?? []) as unknown as { id: string; text: string; due_date: string | null; checklist: { id: string; title: string } }[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-gray-600">Welcome, {profile.full_name || profile.email} · {formatDate(today)}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Today's surgeries">
          {surgeries.length === 0 ? (
            <p className="text-sm text-gray-600">No surgeries booked today.</p>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm">
              {surgeries.map((s) => (
                <li key={s.id} data-testid="dash-surgery" className="flex flex-wrap gap-x-4 py-1.5">
                  <span className="font-medium">{formatTime(s.starts_at)}–{formatTime(s.ends_at)}</span>
                  <span>{chairName.get(s.chair_id) ?? 'Chair'}</span>
                  {s.patient && (
                    <Link href={`/patients/${s.patient.id}`} className="text-blue-700 hover:underline">{s.patient.full_name}</Link>
                  )}
                  {s.implants.length > 0 && <span className="text-gray-600">teeth {s.implants.map((i) => i.tooth).join(', ')}</span>}
                  {s.status === 'done' && <span className="text-green-800">done</span>}
                </li>
              ))}
            </ul>
          )}
          <Link href={`/schedule?date=${today}`} className="text-sm text-blue-700 hover:underline">Open today’s schedule</Link>
        </Card>

        <Card title="Stock shortages for surgeries">
          {shortages.length === 0 ? (
            <p className="text-sm text-gray-600">Stock covers today’s and tomorrow’s planned implants.</p>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm">
              {shortages.map((r) => (
                <li key={`${r.day}-${r.product_id}`} data-testid="dash-shortage" className="flex flex-wrap gap-x-4 py-1.5">
                  <span className="font-medium">{r.day}</span>
                  <span>{productLabel(r)}</span>
                  <span className="text-red-800">need {r.needed}, have {r.available}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Low stock">
          {low.length === 0 ? (
            <p className="text-sm text-gray-600">Nothing is at or below its reorder level.</p>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm">
              {low.map((r) => (
                <li key={r.id} data-testid="dash-low" className="flex flex-wrap gap-x-4 py-1.5">
                  <Link href={`/inventory/products/${r.id}`} className="text-blue-700 hover:underline">{productLabel(r)}</Link>
                  <span>{r.on_hand} left (reorder at {r.reorder_level})</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Expiring soon">
          {expiring.length === 0 ? (
            <p className="text-sm text-gray-600">Nothing expires in the next {settings.expiry_alert_days} days.</p>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm">
              {expiring.map((r) => (
                <li key={r.id} data-testid="dash-expiring" className="flex flex-wrap gap-x-4 py-1.5">
                  <Link href={`/inventory/products/${r.id}`} className="text-blue-700 hover:underline">{productLabel(r)}</Link>
                  <span>{r.nearest_expiry ? `expires ${formatDate(r.nearest_expiry)}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="My open checklist items">
          {myItems.length === 0 ? (
            <p className="text-sm text-gray-600">Nothing assigned to you is open.</p>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm">
              {myItems.map((i) => (
                <li key={i.id} data-testid="dash-my-item" className="flex flex-wrap gap-x-4 py-1.5">
                  <span className="font-medium">{i.text}</span>
                  <Link href={`/checklists/${i.checklist.id}`} className="text-blue-700 hover:underline">{i.checklist.title}</Link>
                  {i.due_date && <span className="text-gray-600">due {formatDate(i.due_date)}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
