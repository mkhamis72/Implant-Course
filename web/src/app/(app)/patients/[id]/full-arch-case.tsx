'use client';

import { useState, useTransition, type FormEvent, type ReactNode } from 'react';
import type { ChartData, ImplantSite } from '@/lib/inventory/types';
import { SITE_STATE_LABELS } from '@/lib/inventory/types';
import { earliestDate } from '@/lib/dates';
import { formatDate, formatDateTime } from '@/lib/format';
import { typeShortLabel } from '@/lib/patients/implant-type';
import { jawOf } from '@/lib/restorations/restorations';
import {
  ARCH_LABELS, CASE_STAGES, CASE_STAGE_LABELS, CASE_STATUS_LABELS, CONFIGURATIONS, CONFIGURATION_LABELS, caseBridges, caseStatus,
  caseTitle, type Arch, type CaseBridges, type CaseStage, type CaseStageRow, type CaseStatus, type FullArchCase,
} from '@/lib/full-arch/cases';
import type { ArchCaption } from '@/components/full-arch/full-arch';
import { clearCaseStage, closeCase, createCase, recordCaseStage, reopenCase, setCaseSites, updateCase } from './case-actions';

type Result = { error?: string };

const STATUS_BADGE: Record<CaseStatus, string> = { planned: '', in_treatment: 'badge-accent', completed: 'badge-ok', closed: '' };
const SHORT_STAGE: Record<CaseStage, string> = { scan: 'Scan', lab_design: 'Lab', try_in: 'Try-in' };
/** Planned and placed implants start ticked in a new case; a failed one is offered but left to the user. */
const PRE_TICKED = ['planned', 'placed', 'restored'];
const HAS_PLACEMENT = ['placed', 'restored', 'failed'];

const archOf = (tooth: number): Arch => jawOf(tooth);

/** The case each arch shows on the drawing: its open case, else its newest one. */
function shownCase(cases: readonly FullArchCase[], arch: Arch): FullArchCase | undefined {
  const mine = cases.filter((c) => c.arch === arch);
  return mine.find((c) => !c.closed_at) ?? mine[0];
}

/** "Upper arch · All-on-4 · In treatment" with "Scan ✓ · Lab — · Try-in — · Delivery —", for the Full arch drawing. */
export function caseCaptions(data: ChartData): ArchCaption[] {
  return (['upper', 'lower'] as const).flatMap((arch) => {
    const c = shownCase(data.cases, arch);
    if (!c) return [];
    const done = (s: CaseStage) => c.stages.some((row) => row.stage === s);
    const delivered = caseBridges(c, data.sites, data.restorations).complete;
    const progress = [
      ...CASE_STAGES.map((s) => `${SHORT_STAGE[s]} ${done(s) ? '✓' : '—'}`),
      `Delivery ${delivered ? '✓' : '—'}`,
    ].join(' · ');
    return [{ arch, title: `${caseTitle(c)} · ${CASE_STATUS_LABELS[caseStatus(c, data.sites, data.restorations)]}`, progress }];
  });
}

function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function run(action: (input: Record<string, unknown>) => Promise<Result>, input: Record<string, unknown>, onDone?: () => void) {
    setError(null);
    start(async () => {
      const result = await action(input);
      if (result.error) setError(result.error);
      else onDone?.();
    });
  }
  return { error, pending, run };
}

function Labelled({ label, required = false, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">
        {label}
        {required && <span aria-hidden="true" className="text-bad"> *</span>}
      </span>
      {children}
    </label>
  );
}

function Buttons({ error, pending, saveLabel, onCancel }: { error: string | null; pending: boolean; saveLabel: string; onCancel: () => void }) {
  return (
    <>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn" disabled={pending}>{saveLabel}</button>
        <button type="button" className="btn-secondary btn" onClick={onCancel}>Cancel</button>
      </div>
    </>
  );
}

const text = (form: FormData, key: string) => String(form.get(key) ?? '');

function siteLabel(s: ImplantSite): string {
  const type = typeShortLabel(s.implant_type);
  return [String(s.tooth), type, SITE_STATE_LABELS[s.state]].filter(Boolean).join(' · ');
}

/** The arch's implants that a case can hold (not cancelled, not in another open case), in tooth order. */
function candidatesFor(data: ChartData, arch: Arch, caseId: string | null): ImplantSite[] {
  const closed = new Set(data.cases.filter((c) => c.closed_at).map((c) => c.id));
  const available = (s: ImplantSite) => s.case_id === null || s.case_id === caseId || closed.has(s.case_id);
  return data.sites
    .filter((s) => archOf(s.tooth) === arch && s.state !== 'removed' && available(s))
    .sort((a, b) => a.tooth - b.tooth);
}

function SiteChecklist({ sites, checked }: { sites: ImplantSite[]; checked: (s: ImplantSite) => boolean }) {
  return (
    <fieldset>
      <legend className="label">Implants</legend>
      {sites.length === 0 ? (
        <p className="text-sm text-muted">No implants planned or placed on this arch yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {sites.map((s) => (
            <label key={s.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-sm hover:bg-sunken has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
              <input type="checkbox" name="sites" value={s.id} defaultChecked={checked(s)} />
              {siteLabel(s)}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

/** Configuration, name and notes: shared by Start and Edit. */
function CaseFields({ c }: { c?: FullArchCase }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Labelled label="Configuration" required>
          <select name="configuration" className="input" aria-required="true" defaultValue={c?.configuration ?? 'all_on_4'}>
            {CONFIGURATIONS.map((x) => <option key={x} value={x}>{CONFIGURATION_LABELS[x]}</option>)}
          </select>
        </Labelled>
        <Labelled label="Name (optional)">
          <input name="name" className="input" maxLength={60} defaultValue={c?.name ?? ''} />
        </Labelled>
      </div>
      <Labelled label="Notes">
        <textarea name="notes" className="input" rows={2} maxLength={1000} defaultValue={c?.notes ?? ''} />
      </Labelled>
    </>
  );
}

function StartForm({ patientId, data, arch, onDone }: { patientId: string; data: ChartData; arch: Arch; onDone: () => void }) {
  const { error, pending, run } = useAction();
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    run(createCase, {
      patientId, arch, configuration: text(form, 'configuration'), name: text(form, 'name'), notes: text(form, 'notes'),
      sites: form.getAll('sites').map(String),
    }, onDone);
  }
  return (
    <form aria-label={`New ${arch} case`} className="space-y-3 rounded-lg border border-line p-3" onSubmit={submit}>
      <h3 className="font-semibold">{`New full-arch case · ${ARCH_LABELS[arch]}`}</h3>
      <CaseFields />
      <SiteChecklist sites={candidatesFor(data, arch, null)} checked={(s) => PRE_TICKED.includes(s.state)} />
      <Buttons error={error} pending={pending} saveLabel="Start case" onCancel={onDone} />
    </form>
  );
}

function EditForm({ patientId, c, onDone }: { patientId: string; c: FullArchCase; onDone: () => void }) {
  const { error, pending, run } = useAction();
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    run(updateCase, {
      patientId, caseId: c.id, configuration: text(form, 'configuration'), name: text(form, 'name'), notes: text(form, 'notes'),
      expectedUpdatedAt: c.updated_at,
    }, onDone);
  }
  return (
    <form className="space-y-3 rounded-lg border border-line p-3" onSubmit={submit}>
      <CaseFields c={c} />
      <Buttons error={error} pending={pending} saveLabel="Save case" onCancel={onDone} />
    </form>
  );
}

function SitesForm({ patientId, data, c, onDone }: { patientId: string; data: ChartData; c: FullArchCase; onDone: () => void }) {
  const { error, pending, run } = useAction();
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    run(setCaseSites, { patientId, caseId: c.id, sites: form.getAll('sites').map(String), expectedUpdatedAt: c.updated_at }, onDone);
  }
  return (
    <form className="space-y-3 rounded-lg border border-line p-3" onSubmit={submit}>
      <SiteChecklist sites={candidatesFor(data, c.arch, c.id)} checked={(s) => s.case_id === c.id} />
      <Buttons error={error} pending={pending} saveLabel="Save implants" onCancel={onDone} />
    </form>
  );
}

function StageForm({ patientId, c, stage, row, min, max, onDone }: {
  patientId: string; c: FullArchCase; stage: CaseStage; row: CaseStageRow | undefined; min: string; max: string; onDone: () => void;
}) {
  const { error, pending, run } = useAction();
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const fit = text(form, 'passiveFit');
    run(recordCaseStage, {
      patientId, caseId: c.id, stage, doneOn: text(form, 'doneOn'),
      lab: stage === 'lab_design' ? text(form, 'lab') : null,
      passiveFit: stage === 'try_in' && fit ? fit === 'yes' : null,
      occlusion: stage === 'try_in' ? text(form, 'occlusion') : null,
      notes: text(form, 'notes'),
    }, onDone);
  }
  return (
    <form aria-label={CASE_STAGE_LABELS[stage]} className="mt-2 space-y-3 rounded-lg border border-line bg-surface p-3" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Labelled label="Date" required>
          <input name="doneOn" type="date" className="input" aria-required="true" min={min} max={max} defaultValue={row?.done_on ?? max} />
        </Labelled>
        {stage === 'lab_design' && (
          <Labelled label="Lab name">
            <input name="lab" className="input" maxLength={120} defaultValue={row?.lab ?? ''} />
          </Labelled>
        )}
        {stage === 'try_in' && (
          <Labelled label="Passive fit">
            <select name="passiveFit" className="input" defaultValue={row?.passive_fit === true ? 'yes' : row?.passive_fit === false ? 'no' : ''}>
              <option value="">— not recorded</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </Labelled>
        )}
      </div>
      {stage === 'try_in' && (
        <Labelled label="Occlusion">
          <input name="occlusion" className="input" maxLength={500} defaultValue={row?.occlusion ?? ''} />
        </Labelled>
      )}
      <Labelled label="Notes">
        <input name="notes" className="input" maxLength={1000} defaultValue={row?.notes ?? ''} />
      </Labelled>
      <Buttons error={error} pending={pending} saveLabel="Save stage" onCancel={onDone} />
    </form>
  );
}

function stageDetails(row: CaseStageRow): string {
  return [
    row.lab,
    row.passive_fit === null ? null : `Passive fit: ${row.passive_fit ? 'yes' : 'no'}`,
    row.occlusion && `Occlusion: ${row.occlusion}`,
    row.notes,
  ].filter(Boolean).join(' · ');
}

function StageRow({ patientId, c, stage, row, min, max, editable }: {
  patientId: string; c: FullArchCase; stage: CaseStage; row: CaseStageRow | undefined; min: string | undefined; max: string; editable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const { error, pending, run } = useAction();
  const details = row ? stageDetails(row) : '';
  return (
    <li data-testid={`stage-${stage}`} className="py-2">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{CASE_STAGE_LABELS[stage]}</p>
          {row ? <p className="text-ok">✓ {formatDate(row.done_on)}</p> : <p className="text-muted">Not recorded</p>}
        </div>
        {editable && min && !editing && (
          <span className="flex shrink-0 gap-2">
            <button type="button" className="btn-secondary btn" onClick={() => setEditing(true)}>{row ? 'Edit' : 'Record'}</button>
            {row && (
              <button type="button" className="btn-secondary btn" disabled={pending}
                onClick={() => run(clearCaseStage, { patientId, caseId: c.id, stage })}>Clear</button>
            )}
          </span>
        )}
      </div>
      {details && <p className="text-sm text-muted">{details}</p>}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      {editing && min && (
        <StageForm patientId={patientId} c={c} stage={stage} row={row} min={min} max={max} onDone={() => setEditing(false)} />
      )}
    </li>
  );
}

function CloseControl({ patientId, c }: { patientId: string; c: FullArchCase }) {
  const [open, setOpen] = useState(false);
  const { error, pending, run } = useAction();
  if (!open) return <button type="button" className="btn-secondary btn" onClick={() => setOpen(true)}>Close case</button>;
  return (
    <form className="space-y-2" onSubmit={(e) => {
      e.preventDefault();
      const form = new FormData(e.currentTarget);
      run(closeCase, { patientId, caseId: c.id, reason: text(form, 'reason'), expectedUpdatedAt: c.updated_at }, () => setOpen(false));
    }}>
      <div className="flex flex-wrap items-end gap-2">
        <Labelled label="Reason for closing" required>
          <input name="reason" className="input" aria-required="true" maxLength={500} />
        </Labelled>
        <button className="btn-danger btn" disabled={pending}>Close the case</button>
        <button type="button" className="btn-secondary btn" onClick={() => setOpen(false)}>Keep open</button>
      </div>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
    </form>
  );
}

/** "Delivered 01 Jun 2030", or for finals that leave implants out "Fitted 01 Jun 2030 · covers 12, 22 of 15, 12, 22, 25". */
function finalLine(b: CaseBridges): string {
  if (b.deliveredOn) return `Delivered ${formatDate(b.deliveredOn)}`;
  if (b.finals.length === 0) return 'Not yet';
  const covers = b.coveredTeeth.length ? b.coveredTeeth.join(', ') : 'none';
  return `Fitted ${formatDate(b.finals[0].fitted_on)} · covers ${covers} of ${b.neededTeeth.join(', ')}`;
}

function CaseCard({patientId, data, c }: { patientId: string; data: ChartData; c: FullArchCase }) {
  const [mode, setMode] = useState<'view' | 'edit' | 'sites'>('view');
  const reopen = useAction();
  const status = caseStatus(c, data.sites, data.restorations);
  const closed = c.closed_at !== null;
  const editable = data.editable && !closed;
  const sites = data.sites.filter((s) => s.case_id === c.id).sort((a, b) => a.tooth - b.tooth);
  const firstPlacement = earliestDate(sites.filter((s) => HAS_PLACEMENT.includes(s.state)).map((s) => s.placed_on));
  const bridges = caseBridges(c, data.sites, data.restorations);
  const title = caseTitle(c);
  return (
    <section aria-label={title} className="space-y-3">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold">{title}</h3>
        <span className={`badge ${STATUS_BADGE[status]}`}>{CASE_STATUS_LABELS[status]}</span>
        {c.name.trim() && <span className="text-sm text-muted">{CONFIGURATION_LABELS[c.configuration]}</span>}
        {editable && mode === 'view' && (
          <button type="button" className="btn-secondary btn ml-auto" onClick={() => setMode('edit')}>Edit case</button>
        )}
      </header>
      {closed && (
        <p className="text-sm text-muted">{`Closed ${formatDateTime(c.closed_at!)}: ${c.close_reason ?? ''}`}</p>
      )}
      {mode === 'edit' ? <EditForm patientId={patientId} c={c} onDone={() => setMode('view')} /> : c.notes && <p className="text-sm">{c.notes}</p>}

      <div>
        <h4 className="label">Implants</h4>
        {mode === 'sites' ? (
          <SitesForm patientId={patientId} data={data} c={c} onDone={() => setMode('view')} />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {sites.length === 0
              ? <span className="text-sm text-muted">No implants in this case.</span>
              : sites.map((s) => <span key={s.id} className="badge">{siteLabel(s)}</span>)}
            {editable && mode === 'view' && (
              <button type="button" className="btn-secondary btn" onClick={() => setMode('sites')}>Change implants</button>
            )}
          </div>
        )}
      </div>

      <div>
        <h4 className="label">Bridges</h4>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Temporary</dt>
          <dd data-testid="bridge-temporary">{bridges.temporary ? `Delivered ${formatDate(bridges.temporary.fitted_on)}` : 'Not yet'}</dd>
          <dt className="text-muted">Final</dt>
          <dd data-testid="bridge-final">{finalLine(bridges)}</dd>
        </dl>
      </div>

      <div>
        <h4 className="label">Final bridge stages</h4>
        {editable && !firstPlacement && (
          <p className="text-sm text-muted">Record a stage after an implant of the case is placed.</p>
        )}
        <ol className="divide-y divide-line text-sm">
          {CASE_STAGES.map((stage) => (
            <StageRow key={stage} patientId={patientId} c={c} stage={stage} row={c.stages.find((r) => r.stage === stage)}
              min={firstPlacement} max={data.today} editable={editable} />
          ))}
          <li data-testid="stage-delivery" className="py-2">
            <p className="font-medium">Delivery</p>
            {bridges.deliveredOn ? <p className="text-ok">✓ {formatDate(bridges.deliveredOn)}</p> : <p className="text-muted">Not yet</p>}
          </li>
        </ol>
      </div>

      {data.editable && (closed ? (
        <div className="space-y-2">
          <button type="button" className="btn-secondary btn" disabled={reopen.pending}
            onClick={() => reopen.run(reopenCase, { patientId, caseId: c.id, expectedUpdatedAt: c.updated_at })}>Reopen</button>
          {reopen.error && <p role="alert" className="text-sm text-bad">{reopen.error}</p>}
        </div>
      ) : mode === 'view' && <CloseControl patientId={patientId} c={c} />)}
    </section>
  );
}

/** One arch's full-arch cases under the Full arch drawing, or a Start button for editors when the arch has no open case. */
export function FullArchCasePanel({ patientId, data, arch }: { patientId: string; data: ChartData; arch: Arch }) {
  const [starting, setStarting] = useState(false);
  const cases = data.cases.filter((c) => c.arch === arch);
  const canStart = data.editable && !cases.some((c) => !c.closed_at);
  if (cases.length === 0 && !canStart) return null;
  return (
    <div className="card space-y-4">
      {cases.map((c) => <CaseCard key={c.id} patientId={patientId} data={data} c={c} />)}
      {canStart && (starting
        ? <StartForm patientId={patientId} data={data} arch={arch} onDone={() => setStarting(false)} />
        : <button type="button" className="btn-secondary btn" onClick={() => setStarting(true)}>{`Start ${arch} case`}</button>)}
    </div>
  );
}
