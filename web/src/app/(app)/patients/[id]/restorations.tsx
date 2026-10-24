'use client';

import { useState, useTransition } from 'react';
import type { ChartData, ImplantSite, Option } from '@/lib/inventory/types';
import { latestDate, todayIso } from '@/lib/dates';
import { formatDate } from '@/lib/format';
import {
  ARCH_ORDER, LOADING_LABELS, MATERIALS, MATERIAL_LABELS, PROBLEM_ACTIONS, PROBLEM_ACTION_LABELS, PROBLEM_TYPES, PROBLEM_TYPE_LABELS, RESTORATION_STAGES,
  RESTORATION_TYPES, RESTORATION_TYPE_LABELS, RETENTIONS, RETENTION_LABELS, STAGE_LABELS,
  coursesForDate, describeTeeth, isCurrent, jawOf, loadingOf, type CourseOption, type Restoration, type RestorationProblem,
} from '@/lib/restorations/restorations';
import { Field, Footer, useSubmit } from './implant-forms';
import {
  addRestoration, recordRestorationProblem, updateRestoration, updateRestorationProblem, voidRestoration, voidRestorationProblem,
} from './restoration-actions';

const IN_PLACE = ['placed', 'restored'];

/** Newest first; on the same date the current one comes before the one it ended. */
function newestFirst(a: Restoration, b: Restoration): number {
  if (a.fitted_on !== b.fitted_on) return a.fitted_on < b.fitted_on ? 1 : -1;
  return Number(isCurrent(b)) - Number(isCurrent(a));
}

/** The Restoration tab: loading, the implant's restorations newest first, and the add form. */
export function Restorations({ site, patientId, data }: { site: ImplantSite; patientId: string; data: ChartData }) {
  const [adding, setAdding] = useState(false);
  const mine = data.restorations.filter((r) => r.site_ids.includes(site.id)).sort(newestFirst);
  const loading = site.placed_on ? loadingOf(site.placed_on, mine) : null;
  const canAdd = data.editable && IN_PLACE.includes(site.state);
  return (
    <div data-testid="restorations" className="space-y-3">
      <p className={loading ? '' : 'text-muted'}>{`Loading: ${loading ? LOADING_LABELS[loading] : 'not restored yet'}`}</p>
      {mine.length === 0 && !adding && <p className="text-muted">No restoration recorded.</p>}
      {adding && <RestorationForm site={site} patientId={patientId} data={data} onDone={() => setAdding(false)} />}
      {canAdd && !adding && (
        <button type="button" className="btn-secondary btn" onClick={() => setAdding(true)}>Add restoration</button>
      )}
      <ul className="space-y-2">
        {mine.map((r, i) => (
          <li key={r.id}>
            <RestorationCard r={r} patientId={patientId} data={data} editable={data.editable && i === 0} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function nameOf(options: Option[], id: string | null, recorded: string | null | undefined): string | null {
  if (!id) return null;
  return options.find((o) => o.id === id)?.label ?? recorded ?? null;
}

/** One restoration: what it is, its details and problems; the newest can be edited or undone. */
export function RestorationCard({ r, patientId, data, editable }: { r: Restoration; patientId: string; data: ChartData; editable: boolean }) {
  const [mode, setMode] = useState<'view' | 'edit' | 'undo'>('view');
  const [reason, setReason] = useState('');
  const [addingProblem, setAddingProblem] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const current = isCurrent(r);
  function undo() {
    setError(null);
    start(async () => {
      const result = await voidRestoration({ patientId, restorationId: r.id, reason });
      if (result.error) setError(result.error);
    });
  }
  const course = r.course_id ? data.courses.find((c) => c.id === r.course_id)?.name ?? r.course?.name ?? null : null;
  const facts = [
    `Fitted ${formatDate(r.fitted_on)}`,
    r.retention ? RETENTION_LABELS[r.retention] : null,
    r.material ? MATERIAL_LABELS[r.material] : null,
  ].filter(Boolean).join(' · ');
  const people = [
    nameOf(data.delegates, r.delegate_id, r.delegate?.full_name) && `Fitted by ${nameOf(data.delegates, r.delegate_id, r.delegate?.full_name)}`,
    nameOf(data.supervisors, r.supervisor_id, r.supervisor?.full_name) && `supervised by ${nameOf(data.supervisors, r.supervisor_id, r.supervisor?.full_name)}`,
    course && `course ${course}`,
  ].filter(Boolean).join(' · ');
  return (
    <div data-testid="restoration" className={current ? 'space-y-1 rounded-lg border border-accent bg-accent-soft p-3' : 'space-y-1 rounded-lg border border-line p-3 text-muted'}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{STAGE_LABELS[r.stage]} · {RESTORATION_TYPE_LABELS[r.type]}</span>
        <span>on {describeTeeth(r.teeth)}</span>
        {current && <span className="badge badge-accent">Current</span>}
      </div>
      {r.end_kind === 'replaced' && r.ended_on && <p>Replaced on {formatDate(r.ended_on)}</p>}
      {r.end_kind === 'remade' && r.ended_on && <p>Remade on {formatDate(r.ended_on)} — {r.end_reason}</p>}
      {mode === 'edit' ? (
        <DetailsForm r={r} patientId={patientId} data={data} onDone={() => setMode('view')} />
      ) : (
        <>
          <p>{facts}</p>
          {people && <p>{people}</p>}
          {r.notes && <p>{r.notes}</p>}
        </>
      )}
      {r.problems.length > 0 && (
        <div>
          <p className="font-medium">Problems</p>
          <ul className="space-y-1">
            {r.problems.map((p) => <ProblemItem key={p.id} r={r} p={p} patientId={patientId} editable={data.editable} />)}
          </ul>
        </div>
      )}
      {data.editable && !addingProblem && (
        <button type="button" className="btn-secondary btn" onClick={() => setAddingProblem(true)}>Record a problem</button>
      )}
      {addingProblem && <ProblemForm r={r} patientId={patientId} onDone={() => setAddingProblem(false)} />}
      {editable && mode === 'view' && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary btn" onClick={() => setMode('edit')}>Edit details</button>
          {current && <button type="button" className="btn-secondary btn" onClick={() => setMode('undo')}>Undo</button>}
        </div>
      )}
      {mode === 'undo' && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="label">Reason for undoing</span>
            <input className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button type="button" className="btn-danger btn" disabled={pending} onClick={undo}>Undo restoration</button>
          <button type="button" className="btn-secondary btn" onClick={() => setMode('view')}>Keep</button>
        </div>
      )}
      {error && <p role="alert" className="text-bad">{error}</p>}
    </div>
  );
}

/** One problem line; editors can change it or remove it from the record with a reason. */
function ProblemItem({ r, p, patientId, editable }: { r: Restoration; p: RestorationProblem; patientId: string; editable: boolean }) {
  const [mode, setMode] = useState<'view' | 'edit' | 'remove'>('view');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function remove() {
    setError(null);
    start(async () => {
      const result = await voidRestorationProblem({ patientId, problemId: p.id, reason });
      if (result.error) setError(result.error);
    });
  }
  if (mode === 'edit') return <li><ProblemForm r={r} p={p} patientId={patientId} onDone={() => setMode('view')} /></li>;
  return (
    <li className="space-y-1">
      <span>
        {PROBLEM_TYPE_LABELS[p.type]} · {formatDate(p.noticed_on)} · {PROBLEM_ACTION_LABELS[p.action]}
        {p.notes && ` · ${p.notes}`}
      </span>
      {editable && mode === 'view' && (
        <span className="ml-2 inline-flex gap-2">
          <button type="button" className="btn-secondary btn" onClick={() => setMode('edit')}>Edit problem</button>
          <button type="button" className="btn-secondary btn" onClick={() => setMode('remove')}>Remove problem</button>
        </span>
      )}
      {mode === 'remove' && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="label">Reason for removing</span>
            <input className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button type="button" className="btn-danger btn" disabled={pending} onClick={remove}>Remove from record</button>
          <button type="button" className="btn-secondary btn" onClick={() => setMode('view')}>Keep</button>
        </div>
      )}
      {error && <p role="alert" className="text-bad">{error}</p>}
    </li>
  );
}

/** Records a problem on a restoration, or edits one (with the version it opened with). */
function ProblemForm({ r, p, patientId, onDone }: { r: Restoration; p?: RestorationProblem; patientId: string; onDone: () => void }) {
  const [version] = useState(p?.updated_at ?? '');
  const today = todayIso();
  const [v, setV] = useState({
    type: p?.type ?? '', noticedOn: p?.noticed_on ?? (r.ended_on && r.ended_on < today ? r.ended_on : today),
    action: p?.action ?? '', notes: p?.notes ?? '',
  });
  const { error, pending, submit } = useSubmit(p ? updateRestorationProblem : recordRestorationProblem, onDone);
  return (
    <form className="space-y-3 rounded-lg border border-line bg-surface p-3 text-ink" onSubmit={(e) => {
      e.preventDefault();
      submit({ patientId, restorationId: r.id, ...(p ? { problemId: p.id, expectedUpdatedAt: version } : {}), ...v });
    }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Problem" required>
          <select className="input" aria-required="true" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>
            <option value="">Choose…</option>
            {PROBLEM_TYPES.map((t) => <option key={t} value={t}>{PROBLEM_TYPE_LABELS[t]}</option>)}
          </select>
        </Field>
        <Field label="Noticed on" required>
          <input className="input" type="date" aria-required="true" min={r.fitted_on} max={r.ended_on && r.ended_on < today ? r.ended_on : today} value={v.noticedOn} onChange={(e) => setV({ ...v, noticedOn: e.target.value })} />
        </Field>
        <Field label="Action taken" required>
          <select className="input" aria-required="true" value={v.action} onChange={(e) => setV({ ...v, action: e.target.value })}>
            <option value="">Choose…</option>
            {PROBLEM_ACTIONS.map((a) => <option key={a} value={a}>{PROBLEM_ACTION_LABELS[a]}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Notes">
        <input className="input" value={v.notes} maxLength={1000} onChange={(e) => setV({ ...v, notes: e.target.value })} />
      </Field>
      <Footer error={error} pending={pending} saveLabel="Save problem" onCancel={onDone} />
    </form>
  );
}

type Details = { retention: string; material: string; delegateId: string; supervisorId: string; courseId: string; notes: string };

/** A recorded person or course no longer in the list (inactive, or a course the reader can't see) stays choosable. */
function withRecorded(options: Option[], id: string, name: string | null | undefined): Option[] {
  if (!id || options.some((o) => o.id === id)) return options;
  return [...options, { id, label: `${name ?? 'Unknown'} (inactive)` }];
}

/** Retention, material, people, course and notes: the details that can be edited later. */
function DetailsFields({ v, set, data, fittedOn, recorded }: {
  v: Details; set: (key: keyof Details) => (value: string) => void; data: ChartData; fittedOn: string; recorded?: Restoration;
}) {
  const delegates = withRecorded(data.delegates, v.delegateId, recorded?.delegate?.full_name);
  const supervisors = withRecorded(data.supervisors, v.supervisorId, recorded?.supervisor?.full_name);
  const known: CourseOption[] = v.courseId && !data.courses.some((c) => c.id === v.courseId)
    ? [...data.courses, { id: v.courseId, name: recorded?.course?.name ?? 'Unknown course', start_date: '', end_date: '' }]
    : data.courses;
  const { running, others } = coursesForDate(known, fittedOn);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Retention">
          <select className="input" value={v.retention} onChange={(e) => set('retention')(e.target.value)}>
            <option value="">— not recorded</option>
            {RETENTIONS.map((x) => <option key={x} value={x}>{RETENTION_LABELS[x]}</option>)}
          </select>
        </Field>
        <Field label="Material">
          <select className="input" value={v.material} onChange={(e) => set('material')(e.target.value)}>
            <option value="">— not recorded</option>
            {MATERIALS.map((x) => <option key={x} value={x}>{MATERIAL_LABELS[x]}</option>)}
          </select>
        </Field>
        <Field label="Delegate">
          <select className="input" value={v.delegateId} onChange={(e) => set('delegateId')(e.target.value)}>
            <option value="">—</option>
            {delegates.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </Field>
        <Field label="Supervisor">
          <select className="input" value={v.supervisorId} onChange={(e) => set('supervisorId')(e.target.value)}>
            <option value="">—</option>
            {supervisors.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Course">
          <select className="input" value={v.courseId} onChange={(e) => set('courseId')(e.target.value)}>
            <option value="">—</option>
            {running.length > 0 && (
              <optgroup label={`Running on ${formatDate(fittedOn)}`}>
                {running.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label={running.length > 0 ? 'Other courses' : 'Courses'}>
                {others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            )}
          </select>
        </Field>
      </div>
      <Field label="Notes">
        <input className="input" value={v.notes} maxLength={1000} onChange={(e) => set('notes')(e.target.value)} />
      </Field>
    </>
  );
}

function DetailsForm({ r, patientId, data, onDone }: { r: Restoration; patientId: string; data: ChartData; onDone: () => void }) {
  // The version this form opened with, so a stale edit is refused rather than overwriting someone else's.
  const [version] = useState(r.updated_at);
  const [v, setV] = useState<Details>({
    retention: r.retention ?? '', material: r.material ?? '', delegateId: r.delegate_id ?? '', supervisorId: r.supervisor_id ?? '',
    courseId: r.course_id ?? '', notes: r.notes,
  });
  const set = (key: keyof Details) => (value: string) => setV((cur) => ({ ...cur, [key]: value }));
  const { error, pending, submit } = useSubmit(updateRestoration, onDone);
  return (
    <form className="space-y-3 rounded-lg border border-line bg-surface p-3 text-ink" onSubmit={(e) => {
      e.preventDefault();
      submit({ patientId, restorationId: r.id, expectedUpdatedAt: version, ...v });
    }}>
      <DetailsFields v={v} set={set} data={data} fittedOn={r.fitted_on} recorded={r} />
      <Footer error={error} pending={pending} saveLabel="Save details" onCancel={onDone} />
    </form>
  );
}

/** The teeth covered: the run between the outermost implants, widened to any extra tooth ticked beyond them. */
function coveredTeeth(implantTeeth: number[], extra: { before: number | null; after: number | null }): number[] {
  if (implantTeeth.length === 0) return [];
  const arch = ARCH_ORDER[jawOf(implantTeeth[0])];
  const pos = [...implantTeeth, extra.before, extra.after].filter((t): t is number => t !== null).map((t) => arch.indexOf(t));
  return arch.slice(Math.min(...pos), Math.max(...pos) + 1);
}

/** Adds a restoration on this implant and any others of the patient in the same jaw. */
export function RestorationForm({ site, patientId, data, onDone }: { site: ImplantSite; patientId: string; data: ChartData; onDone: () => void }) {
  const jaw = jawOf(site.tooth);
  const arch = ARCH_ORDER[jaw];
  const candidates = data.sites
    .filter((s) => IN_PLACE.includes(s.state) && jawOf(s.tooth) === jaw)
    .sort((a, b) => arch.indexOf(a.tooth) - arch.indexOf(b.tooth));
  const [v, setV] = useState({ stage: '', type: '', fittedOn: todayIso(), remakeReason: '' });
  const [details, setDetails] = useState<Details>({ retention: '', material: '', delegateId: '', supervisorId: '', courseId: '', notes: '' });
  const [siteIds, setSiteIds] = useState<string[]>([site.id]);
  const [extra, setExtra] = useState<{ before: number | null; after: number | null }>({ before: null, after: null });
  const { error, pending, submit } = useSubmit(addRestoration, onDone);

  const chosen = candidates.filter((s) => siteIds.includes(s.id));
  const implantTeeth = chosen.map((s) => s.tooth);
  const multi = v.type !== '' && v.type !== 'single_crown';
  const teeth = multi ? coveredTeeth(implantTeeth, extra) : implantTeeth;
  const first = implantTeeth.length ? arch.indexOf(implantTeeth[0]) : -1;
  const last = implantTeeth.length ? arch.indexOf(implantTeeth[implantTeeth.length - 1]) : -1;
  const ending = data.restorations.filter((r) => isCurrent(r) && r.site_ids.some((id) => siteIds.includes(id)));
  const coversFinal = ending.some((r) => r.stage === 'final');

  function toggleSite(id: string) {
    setSiteIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }
  function toggleTooth(tooth: number) {
    const p = arch.indexOf(tooth);
    const on = teeth.includes(tooth);
    if (p < first) setExtra((e) => ({ ...e, before: on ? (p + 1 < first ? arch[p + 1] : null) : tooth }));
    if (p > last) setExtra((e) => ({ ...e, after: on ? (p - 1 > last ? arch[p - 1] : null) : tooth }));
  }

  return (
    <form className="space-y-3 rounded-lg border border-line p-3" onSubmit={(e) => {
      e.preventDefault();
      submit({
        patientId, stage: v.stage, type: v.type, sites: chosen.map((s) => s.id), teeth, fittedOn: v.fittedOn,
        remakeReason: coversFinal ? v.remakeReason : '', ...details,
      });
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Stage" required>
          <select className="input" aria-required="true" value={v.stage} onChange={(e) => setV({ ...v, stage: e.target.value })}>
            <option value="">Choose…</option>
            {RESTORATION_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
          </select>
        </Field>
        <Field label="Type" required>
          <select className="input" aria-required="true" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>
            <option value="">Choose…</option>
            {RESTORATION_TYPES.map((t) => <option key={t} value={t}>{RESTORATION_TYPE_LABELS[t]}</option>)}
          </select>
        </Field>
      </div>
      <fieldset>
        <legend className="label">Implants</legend>
        <div className="flex flex-wrap gap-2">
          {candidates.map((s) => (
            <label key={s.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 hover:bg-sunken has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
              <input type="checkbox" checked={siteIds.includes(s.id)} onChange={() => toggleSite(s.id)} />
              {s.tooth}
            </label>
          ))}
        </div>
      </fieldset>
      {multi && (
        <fieldset>
          <legend className="label">Teeth covered</legend>
          <p className="text-muted">The teeth between the implants are included; tick teeth beyond them for a cantilever.</p>
          <div className="flex flex-wrap gap-1">
            {arch.map((t) => {
              const p = arch.indexOf(t);
              return (
                <label key={t} className="flex min-h-11 min-w-11 cursor-pointer flex-col items-center justify-center rounded-lg border border-line-strong bg-surface px-1 text-xs hover:bg-sunken has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:disabled]:cursor-default">
                  <input type="checkbox" aria-label={String(t)} checked={teeth.includes(t)} disabled={first < 0 || (p >= first && p <= last)} onChange={() => toggleTooth(t)} />
                  <span aria-hidden="true">{t}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
      <Field label="Date fitted" required>
        <input className="input" type="date" aria-required="true" min={latestDate([...chosen.map((s) => s.placed_on), ...ending.map((r) => r.fitted_on)])} max={todayIso()} value={v.fittedOn} onChange={(e) => setV({ ...v, fittedOn: e.target.value })} />
      </Field>
      <DetailsFields v={details} set={(key) => (value) => setDetails((cur) => ({ ...cur, [key]: value }))} data={data} fittedOn={v.fittedOn} />
      {ending.map((r) => (
        <p key={r.id} className="text-muted">Replaces the {r.stage} on {describeTeeth(r.teeth)}</p>
      ))}
      {coversFinal && (
        <Field label="Why was the final remade?" required>
          <input className="input" aria-required="true" maxLength={500} value={v.remakeReason} onChange={(e) => setV({ ...v, remakeReason: e.target.value })} />
        </Field>
      )}
      <Footer error={error} pending={pending} saveLabel="Save restoration" onCancel={onDone} />
    </form>
  );
}
