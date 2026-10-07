'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { productLabel } from '@/lib/inventory/labels';
import { TECHNIQUES, TECHNIQUE_LABELS, type Option, type Product, type Technique } from '@/lib/inventory/types';
import { bookSurgery, updateBooking } from '../actions';

export type SessionOption = { id: string; label: string; courseId: string };
type Role = '' | 'placing' | 'assisting';

/** An existing booking being edited: the session (day) and patient are fixed. */
export type EditedBooking = {
  slotId: string;
  sessionId: string;
  sessionLabel: string;
  patientLabel: string;
  chairId: string;
  supervisorId: string;
  start: string;
  end: string;
  roles: Record<string, Role>;
  implants: { siteId: string; tooth: number; label: string; technique: Technique | '' }[];
  notes: string;
};

type Props = {
  sessions: SessionOption[];
  chairs: Option[];
  patients: { file_no: string; full_name: string }[];
  enrolled: Record<string, Option[]>;
  implants: Product[];
  supervisors: Option[];
  me: string;
  initial: { sessionId: string; chairId: string; start: string; fileNo: string; date?: string };
  edit?: EditedBooking;
};

function TechniqueSelect({ label, value, onChange }: { label: string; value: string; onChange: (v: Technique | '') => void }) {
  return (
    <select className="input w-36" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as Technique | '')}>
      <option value="">Technique…</option>
      {TECHNIQUES.map((t) => <option key={t} value={t}>{TECHNIQUE_LABELS[t]}</option>)}
    </select>
  );
}

export function SlotForm(p: Props) {
  const router = useRouter();
  const edit = p.edit;
  const [sessionId, setSessionId] = useState(edit?.sessionId ?? p.initial.sessionId);
  const [chairId, setChairId] = useState(edit?.chairId ?? p.initial.chairId);
  const [start, setStart] = useState(edit?.start ?? p.initial.start);
  const [end, setEnd] = useState(edit?.end ?? '');
  const [fileNo, setFileNo] = useState(p.initial.fileNo);
  const [supervisorId, setSupervisorId] = useState(edit?.supervisorId ?? (p.supervisors.some((s) => s.id === p.me) ? p.me : ''));
  const [roles, setRoles] = useState<Record<string, Role>>(edit?.roles ?? {});
  const [implants, setImplants] = useState<{ tooth: string; productId: string; technique: Technique | '' }[]>([
    { tooth: '', productId: '', technique: '' },
  ]);
  const [bookedImplants, setBookedImplants] = useState(edit?.implants ?? []);
  const [notes, setNotes] = useState(edit?.notes ?? '');
  const [checked, setChecked] = useState<{ key: string; warnings: string[] } | null>(null);
  const [override, setOverride] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start_] = useTransition();

  const courseId = p.sessions.find((s) => s.id === sessionId)?.courseId ?? '';
  const delegates = useMemo(() => p.enrolled[courseId] ?? [], [p.enrolled, courseId]);

  // Clash warnings belong to the inputs they were checked for; any change hides them.
  const inputKey = JSON.stringify([sessionId, chairId, supervisorId, start, end, fileNo, roles]);
  const warnings = checked?.key === inputKey ? checked.warnings : null;

  function submit(withOverride: boolean) {
    setError(null);
    const people = {
      chairId, start, end, supervisorId,
      placing: delegates.filter((d) => roles[d.id] === 'placing').map((d) => d.id),
      assisting: delegates.filter((d) => roles[d.id] === 'assisting').map((d) => d.id),
      overrideReason: withOverride ? override : '',
      notes,
    };
    start_(async () => {
      const result = edit
        ? await updateBooking({
          ...people,
          slotId: edit.slotId,
          // Only changed techniques are saved, so the history shows real changes.
          implants: bookedImplants
            .filter((i, n) => i.technique !== edit.implants[n].technique)
            .map((i) => ({ siteId: i.siteId, technique: i.technique })),
        })
        : await bookSurgery({ ...people, sessionId, patientFileNo: fileNo, implants: implants.filter((i) => i.tooth.trim() !== '') });
      if (result.error) setError(result.error);
      else if (result.warnings) setChecked({ key: inputKey, warnings: result.warnings });
      else router.push(`/schedule?date=${result.date}`);
    });
  }

  return (
    <form className="card max-w-3xl space-y-4" onSubmit={(e) => { e.preventDefault(); submit(false); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        {edit ? (
          <div className="space-y-1 text-sm sm:col-span-2">
            <p><span className="text-muted">Session:</span> {edit.sessionLabel}</p>
            <p><span className="text-muted">Patient:</span> {edit.patientLabel}</p>
            <p className="text-muted">To move the surgery to another day, cancel it and book again.</p>
          </div>
        ) : (
          <>
            <label className="block sm:col-span-2">
              <span className="label">Surgery session</span>
              <select className="input" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
                <option value="">Choose a session…</option>
                {p.sessions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
            {p.sessions.length === 0 && (
              <p className="-mt-2 text-sm text-warn sm:col-span-2">
                No upcoming surgery sessions. Sessions dated before today aren’t listed — add one with{' '}
                <Link href={p.initial.date ? `/schedule?date=${p.initial.date}` : '/schedule'} className="text-accent underline">Add surgery day</Link>{' '}
                on the Schedule page, or under <Link href="/courses" className="text-accent underline">Courses</Link>.
              </p>
            )}
          </>
        )}
        <label className="block">
          <span className="label">Chair</span>
          <select className="input" value={chairId} onChange={(e) => setChairId(e.target.value)}>
            <option value="">Choose a chair…</option>
            {p.chairs.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <div>
          <label className="block">
            <span className="label">Supervisor</span>
            <select className="input" value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)}>
              <option value="">Choose a supervisor…</option>
              {p.supervisors.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
          {p.supervisors.length === 0 && (
            <p className="mt-1 text-sm text-warn">No supervisors yet — an admin can add them under Admin → Supervisors.</p>
          )}
        </div>
        <label className="block">
          <span className="label">Start</span>
          <input className="input" type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">End</span>
          <input className="input" type="time" step={900} value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        {!edit && (
          <>
            <label className="block sm:col-span-2">
              <span className="label">Patient (file number)</span>
              <input className="input" list="patients" value={fileNo} onChange={(e) => setFileNo(e.target.value)} />
            </label>
            {/* Outside the <label> so its accessible name is just "Patient (file number)". */}
            <datalist id="patients">
              {p.patients.map((pt) => <option key={pt.file_no} value={pt.file_no}>{pt.full_name}</option>)}
            </datalist>
          </>
        )}
      </div>

      <fieldset className="space-y-2">
        <legend className="label">Delegates (enrolled in this course)</legend>
        {!courseId && <p className="text-sm text-muted">Choose a session first.</p>}
        {courseId && delegates.length === 0 && <p className="text-sm text-warn">No delegates are enrolled in this course yet.</p>}
        {delegates.map((d) => (
          <label key={d.id} className="flex items-center gap-3 text-sm">
            <span className="w-56">{d.label}</span>
            <select
              className="input max-w-40 py-1"
              aria-label={`Role of ${d.label}`}
              value={roles[d.id] ?? ''}
              onChange={(e) => setRoles((r) => ({ ...r, [d.id]: e.target.value as Role }))}
            >
              <option value="">Not in this surgery</option>
              <option value="placing">Placing</option>
              <option value="assisting">Assisting</option>
            </select>
          </label>
        ))}
      </fieldset>

      {edit ? (
        bookedImplants.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="label">Implants</legend>
            {bookedImplants.map((row, i) => (
              <div key={row.siteId} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-56">Tooth {row.tooth} · {row.label}</span>
                <TechniqueSelect
                  label={`Technique ${i + 1}`}
                  value={row.technique}
                  onChange={(t) => setBookedImplants((all) => all.map((r, j) => (j === i ? { ...r, technique: t } : r)))}
                />
              </div>
            ))}
          </fieldset>
        )
      ) : (
        <fieldset className="space-y-2">
          <legend className="label">Implants needed</legend>
          {implants.map((row, i) => (
            <div key={i} className="flex flex-wrap gap-2">
              <input
                className="input w-24"
                aria-label={`Tooth ${i + 1}`}
                placeholder="Tooth"
                value={row.tooth}
                onChange={(e) => setImplants((all) => all.map((r, j) => (j === i ? { ...r, tooth: e.target.value } : r)))}
              />
              <select
                className="input flex-1"
                aria-label={`Implant ${i + 1}`}
                value={row.productId}
                onChange={(e) => setImplants((all) => all.map((r, j) => (j === i ? { ...r, productId: e.target.value } : r)))}
              >
                <option value="">Implant not chosen yet</option>
                {p.implants.map((pr) => <option key={pr.id} value={pr.id}>{productLabel(pr)}</option>)}
              </select>
              <TechniqueSelect
                label={`Technique ${i + 1}`}
                value={row.technique}
                onChange={(t) => setImplants((all) => all.map((r, j) => (j === i ? { ...r, technique: t } : r)))}
              />
            </div>
          ))}
          <button
            type="button"
            className="text-sm text-accent hover:underline"
            onClick={() => setImplants((all) => [...all, { tooth: '', productId: '', technique: '' }])}
          >
            + Add another implant
          </button>
        </fieldset>
      )}

      <label className="block">
        <span className="label">Notes (optional)</span>
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {warnings && (
        <div data-testid="clash-warnings" className="space-y-2 rounded bg-warn-soft p-3 text-sm text-warn">
          <p className="font-medium">This booking clashes with:</p>
          <ul className="list-disc pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          <label className="block">
            <span className="label">Reason to book anyway</span>
            <input className="input" value={override} onChange={(e) => setOverride(e.target.value)} />
          </label>
          <button type="button" className="btn" disabled={pending} onClick={() => submit(true)}>
            {edit ? 'Save anyway' : 'Book anyway'}
          </button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <button className="btn" disabled={pending}>{edit ? 'Save changes' : 'Book surgery'}</button>
    </form>
  );
}
