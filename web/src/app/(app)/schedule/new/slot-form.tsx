'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { productLabel } from '@/lib/inventory/labels';
import type { Option, Product } from '@/lib/inventory/types';
import { bookSurgery } from '../actions';

export type SessionOption = { id: string; label: string; courseId: string };

type Props = {
  sessions: SessionOption[];
  chairs: Option[];
  patients: { file_no: string; full_name: string }[];
  enrolled: Record<string, Option[]>;
  implants: Product[];
  organizers: Option[];
  me: string;
  initial: { sessionId: string; chairId: string; start: string; fileNo: string };
};

type Role = '' | 'placing' | 'assisting';

export function SlotForm(p: Props) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState(p.initial.sessionId);
  const [chairId, setChairId] = useState(p.initial.chairId);
  const [start, setStart] = useState(p.initial.start);
  const [end, setEnd] = useState('');
  const [fileNo, setFileNo] = useState(p.initial.fileNo);
  const [supervisorId, setSupervisorId] = useState(p.me);
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [implants, setImplants] = useState([{ tooth: '', productId: '' }]);
  const [notes, setNotes] = useState('');
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
    start_(async () => {
      const result = await bookSurgery({
        sessionId, chairId, start, end, patientFileNo: fileNo, supervisorId,
        placing: delegates.filter((d) => roles[d.id] === 'placing').map((d) => d.id),
        assisting: delegates.filter((d) => roles[d.id] === 'assisting').map((d) => d.id),
        implants: implants.filter((i) => i.tooth.trim() !== ''),
        overrideReason: withOverride ? override : '',
        notes,
      });
      if (result.error) setError(result.error);
      else if (result.warnings) setChecked({ key: inputKey, warnings: result.warnings });
      else router.push(`/schedule?date=${result.date}`);
    });
  }

  return (
    <form className="card max-w-3xl space-y-4" onSubmit={(e) => { e.preventDefault(); submit(false); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="label">Surgery session</span>
          <select className="input" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
            <option value="">Choose a session…</option>
            {p.sessions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        {p.sessions.length === 0 && (
          <p className="-mt-2 text-sm text-warn sm:col-span-2">
            No upcoming surgery sessions. Sessions dated before today aren’t listed — add or edit one under{' '}
            <Link href="/courses" className="text-accent underline">Courses</Link>.
          </p>
        )}
        <label className="block">
          <span className="label">Chair</span>
          <select className="input" value={chairId} onChange={(e) => setChairId(e.target.value)}>
            <option value="">Choose a chair…</option>
            {p.chairs.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">Supervisor</span>
          <select className="input" value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)}>
            {p.organizers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">Start</span>
          <input className="input" type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">End</span>
          <input className="input" type="time" step={900} value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label className="block sm:col-span-2">
          <span className="label">Patient (file number)</span>
          <input className="input" list="patients" value={fileNo} onChange={(e) => setFileNo(e.target.value)} />
        </label>
        {/* Outside the <label> so its accessible name is just "Patient (file number)". */}
        <datalist id="patients">
          {p.patients.map((pt) => <option key={pt.file_no} value={pt.file_no}>{pt.full_name}</option>)}
        </datalist>
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
          </div>
        ))}
        <button type="button" className="text-sm text-accent hover:underline" onClick={() => setImplants((all) => [...all, { tooth: '', productId: '' }])}>
          + Add another implant
        </button>
      </fieldset>

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
          <button type="button" className="btn" disabled={pending} onClick={() => submit(true)}>Book anyway</button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <button className="btn" disabled={pending}>Book surgery</button>
    </form>
  );
}
