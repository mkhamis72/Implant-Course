import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { addDays, isRealDate, todayIso } from '@/lib/dates';
import { formatDate, formatTime } from '@/lib/format';
import { gridPlacement, minutesOfDay, timeLabels } from '@/lib/schedule/time';
import { assignLanes, dayColumns } from '@/lib/schedule/grid';
import type { Chair, SlotRow } from '@/lib/schedule/types';
import { SLOT_SELECT } from '@/lib/schedule/queries';
import { progressOf } from '@/lib/checklists/format';
import { TECHNIQUE_LABELS } from '@/lib/inventory/types';
import { bookingTechnique, TECHNIQUE_SHORT, type BookingTechnique } from '@/lib/schedule/technique';
import { CancelBooking } from './cancel-booking';
import { BookingStatus } from './booking-status';
import { readParams, type PageSearchParams } from '@/lib/search-params';

// Card colours by surgical technique; a booking whose implants differ gets a two-colour stripe.
const CARD: Record<BookingTechnique | 'none', string> = {
  guided: 'border-guided bg-guided-soft',
  free_hand: 'border-accent bg-accent-soft',
  mixed: 'border-guided bg-surface',
  none: 'border-line-strong bg-surface',
};
const MIXED_STRIPE = {
  borderLeftWidth: '6px',
  borderImage: 'linear-gradient(var(--color-guided) 50%, var(--color-accent) 50%) 1',
};

function Legend() {
  const items: [string, string][] = [
    ['border-guided bg-guided-soft', 'Guided'],
    ['border-accent bg-accent-soft', 'Free hand'],
    ['border-line-strong bg-surface', 'Technique not set'],
  ];
  return (
    <ul className="flex flex-wrap items-center gap-4 text-xs text-muted" aria-label="Legend">
      {items.map(([cls, label]) => (
        <li key={label} className="flex items-center gap-1.5">
          <span className={`inline-block h-3 w-4 rounded-sm border ${cls}`} aria-hidden />
          {label}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-4 rounded-sm border bg-surface" style={MIXED_STRIPE} aria-hidden />
        Mixed
      </li>
      <li className="flex items-center gap-1.5">
        <span className="badge badge-ok">Completed</span>
      </li>
    </ul>
  );
}

export default async function SchedulePage({ searchParams }: { searchParams: PageSearchParams }) {
  const raw = (await readParams(searchParams, 'date')).date || undefined;
  const date = raw && isRealDate(String(raw)) ? String(raw) : todayIso();
  const supabase = await createClient();
  const [{ data: chairs }, { data: slots, error }] = await Promise.all([
    supabase.from('chairs').select('id, name, active').order('name'),
    supabase.rpc('slots_on', { p_date: date }).select(SLOT_SELECT),
  ]);
  if (error) throw new Error('Could not load the schedule');
  const bookings = (slots ?? []) as unknown as SlotRow[];
  // Cancelled bookings are listed under the grid so they never cover a live booking.
  const live = bookings.filter((b) => b.status !== 'cancelled');
  const cancelled = bookings.filter((b) => b.status === 'cancelled');
  // Inactive chairs stay visible while they still have bookings that day.
  const chairList = dayColumns((chairs ?? []) as Chair[], live.map((b) => b.chair_id));
  const lanes = assignLanes(
    live.map((b) => ({ id: b.id, chair_id: b.chair_id, start: minutesOfDay(formatTime(b.starts_at)), end: minutesOfDay(formatTime(b.ends_at)) })),
  );
  const labels = timeLabels();

  return (
    <div className="space-y-4">
      <div className="page-header">
        <h1>Schedule · {formatDate(date)}</h1>
        <div className="flex items-center gap-3">
          <Link href={`/schedule/pull-list?date=${date}`} className="text-accent hover:underline">Pull list</Link>
          <Link href={`/schedule/new?date=${date}`} className="btn">New booking</Link>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/schedule?date=${addDays(date, -1)}`} className="btn-secondary btn">← Previous day</Link>
        <Link href={`/schedule?date=${addDays(date, 1)}`} className="btn-secondary btn">Next day →</Link>
        <form className="flex items-center gap-2">
          <input className="input w-auto" type="date" name="date" defaultValue={date} aria-label="Date" />
          <button className="btn-secondary btn">Go</button>
        </form>
      </div>
      {live.length > 0 && <Legend />}
      {chairList.length === 0 ? (
        <p className="card text-muted">No chairs yet. An admin can add chairs under Admin → Chairs.</p>
      ) : (
        <div className="card overflow-x-auto">
          <div
            className="grid min-w-[700px] text-xs"
            style={{ gridTemplateColumns: `4rem repeat(${chairList.length}, minmax(12rem, 1fr))`, gridTemplateRows: `2rem repeat(${labels.length}, 1.25rem)` }}
          >
            <div />
            {chairList.map((c, i) => (
              <div key={c.id} className="border-b border-line px-2 font-semibold" style={{ gridColumn: i + 2, gridRow: 1 }}>{c.name}</div>
            ))}
            {labels.map((label, i) => (
              <div key={i} className="sticky left-0 z-10 border-t border-line bg-surface pr-2 text-right text-muted" style={{ gridColumn: 1, gridRow: i + 2 }}>{label}</div>
            ))}
            {live.map((b) => {
              const col = chairList.findIndex((c) => c.id === b.chair_id);
              if (col < 0) return null;
              const start = formatTime(b.starts_at);
              const end = formatTime(b.ends_at);
              const { row, span } = gridPlacement(start, end);
              const { lane, lanes: laneCount } = lanes[b.id];
              const placing = b.delegates.filter((d) => d.role === 'placing').map((d) => d.delegate?.full_name).join(', ');
              const assisting = b.delegates.filter((d) => d.role === 'assisting').map((d) => d.delegate?.full_name).join(', ');
              const technique = bookingTechnique(b.implants);
              return (
                <div
                  key={b.id}
                  data-testid={`booking-${b.patient?.file_no}`}
                  data-technique={technique ?? 'none'}
                  className={`m-0.5 space-y-0.5 overflow-y-auto rounded-md border p-1.5 ${CARD[technique ?? 'none']} ${b.status === 'done' ? 'opacity-80' : ''}`}
                  style={{
                    ...(technique === 'mixed' ? MIXED_STRIPE : {}),
                    gridColumn: col + 2,
                    gridRow: `${row + 1} / span ${span}`,
                    justifySelf: 'start',
                    width: `calc(${100 / laneCount}% - 4px)`,
                    marginLeft: `calc(${(100 * lane) / laneCount}% + 2px)`,
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="font-semibold">{start}–{end}</span>
                    {b.status === 'done' && <span className="badge badge-ok">Completed</span>}
                  </div>
                  {b.patient && (
                    <Link href={`/patients/${b.patient.id}`} className="block text-accent-strong hover:underline">
                      {b.patient.full_name} ({b.patient.file_no})
                    </Link>
                  )}
                  {b.implants.length > 0 && (
                    <div>
                      Teeth:{' '}
                      {b.implants.map((i, n) => {
                        const t = i.site?.technique;
                        return (
                          <span key={i.tooth}>
                            {n > 0 && ', '}
                            {i.tooth}
                            {t && (
                              <abbr title={TECHNIQUE_LABELS[t]} className={`ml-0.5 no-underline ${t === 'guided' ? 'text-guided' : 'text-accent-strong'}`}>
                                {TECHNIQUE_SHORT[t]}
                              </abbr>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <div>Supervisor: {b.supervisor?.full_name}</div>
                  {placing && <div>Placing: {placing}</div>}
                  {assisting && <div>Assisting: {assisting}</div>}
                  {b.checklists.map((cl) => (
                    <Link key={cl.id} href={`/checklists/${cl.id}`} className="block text-accent-strong hover:underline">
                      Checklist {progressOf(cl.items).label}
                    </Link>
                  ))}
                  {b.override_reason && <div className="text-warn no-underline">Overridden: {b.override_reason}</div>}
                  <div className="flex flex-wrap gap-x-3">
                    {b.status === 'scheduled' && (
                      <Link href={`/schedule/${b.id}/edit`} className="text-xs text-accent-strong hover:underline" aria-label="Edit booking">Edit</Link>
                    )}
                    {b.status !== 'cancelled' && <BookingStatus slotId={b.id} status={b.status} />}
                  </div>
                  {b.status === 'scheduled' && <CancelBooking slotId={b.id} />}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {cancelled.length > 0 && (
        <section className="card space-y-1 text-sm">
          <h2 className="font-semibold">Cancelled bookings</h2>
          <ul className="divide-y divide-line">
            {cancelled.map((b) => (
              <li key={b.id} data-testid={`booking-${b.patient?.file_no}`} className="py-1 text-muted">
                {formatTime(b.starts_at)}–{formatTime(b.ends_at)} · {b.patient?.full_name} ({b.patient?.file_no}) · Cancelled: {b.cancel_reason}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
