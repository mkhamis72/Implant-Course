'use client';

import { useState, useTransition } from 'react';
import type { ImplantSite } from '@/lib/inventory/types';
import {
  FLAPS, FLAP_LABELS, GRAFT_MATERIALS, GRAFT_MATERIAL_LABELS, GRAFT_PROCEDURES, GRAFT_PROCEDURE_LABELS, GRAFT_TIMINGS,
  GRAFT_TIMING_LABELS, HEALINGS, HEALING_LABELS, MEMBRANES, MEMBRANE_LABELS, PHENOTYPES, PHENOTYPE_LABELS, PLACEMENT_TIMINGS,
  PLACEMENT_TIMING_HELP, PLACEMENT_TIMING_LABELS, TORQUE_TYPES, TORQUE_TYPE_LABELS, YES_NO_LABELS,
  daysSinceExtraction, describeGraft, describeSurgery, surgeryCompleteness, timingWarning,
  type ImplantGraft, type PlacementTiming,
} from '@/lib/implants/surgery';
import { BONE_TYPES } from '@/lib/inventory/schemas';
import { YES_NO } from '@/lib/patients/risk-factors';
import { Field, Footer, useSubmit } from './implant-forms';
import { deleteGraft, saveGraft, saveSurgery } from './surgery-actions';

// bare: inside the Surgical details tab, which already shows the count (no collapsible wrapper).
type Props = { site: ImplantSite; patientId: string; editable: boolean; startOpen?: boolean; bare?: boolean };

const TORQUES = ['15', '25', '35', '45'];

function TorqueField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block">
        <span className="label">Insertion torque (Ncm, optional)</span>
        <input className="input" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {TORQUES.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={value === t}
            onClick={() => onChange(t)}
            className={`rounded-full border px-3 py-1 text-sm ${value === t ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line-strong hover:bg-sunken'}`}
          >
            {t} Ncm
          </button>
        ))}
      </div>
    </div>
  );
}

function Choice<T extends string>({ label, value, onChange, values, labels }: {
  label: string; value: string; onChange: (v: string) => void; values: readonly T[]; labels: Record<T, string>;
}) {
  return (
    <Field label={label}>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— not recorded</option>
        {values.map((v) => <option key={v} value={v}>{labels[v]}</option>)}
      </select>
    </Field>
  );
}

export function SurgicalDetails({ site, patientId, editable, startOpen = false, bare = false }: Props) {
  const [editing, setEditing] = useState(false);
  const { recorded, total } = surgeryCompleteness(site.surgery, site);
  const parts = describeSurgery(site.surgery, site.placed_on);
  const grafts = site.grafts ?? [];
  const missingGraft = site.surgery?.grafting_performed === 'yes' && grafts.length === 0;
  const body = (
    <div className={bare ? 'space-y-3' : 'mt-2 space-y-3'}>
      {startOpen && <p className="text-muted">Add surgical details now or later.</p>}
      {editing ? (
        <SurgeryForm site={site} patientId={patientId} onDone={() => setEditing(false)} />
      ) : (
        <>
          {parts.length > 0 ? <p>{parts.join(' · ')}</p> : <p className="text-muted">Nothing recorded yet.</p>}
          {editable && (
            <button type="button" className="btn-secondary btn" onClick={() => setEditing(true)}>Edit surgical details</button>
          )}
        </>
      )}
      {missingGraft && <p className="text-warn">Grafting is marked as performed, but no graft is recorded. Add it below.</p>}
      <Grafts site={site} patientId={patientId} grafts={grafts}
        editable={editable} canAdd={editable && site.surgery?.grafting_performed !== 'no'} />
    </div>
  );
  if (bare) return <div data-testid="surgical-details">{body}</div>;
  return (
    <details open={startOpen} data-testid="surgical-details" className="rounded-lg border border-line px-3 py-2.5">
      <summary className="cursor-pointer font-medium">
        Surgical details{' '}
        <span className={recorded === total ? 'badge badge-ok' : 'badge badge-warn'}>{recorded} of {total} recorded</span>
      </summary>
      {body}
    </details>
  );
}

function SurgeryForm({ site, patientId, onDone }: { site: ImplantSite; patientId: string; onDone: () => void }) {
  const s = site.surgery;
  // The version the form was opened on: a refresh while it is open must not turn a stale save into a silent overwrite.
  const [version] = useState(s?.updated_at ?? '');
  const [v, setV] = useState({
    extractionDate: s?.extraction_date ?? '', placementTiming: s?.placement_timing ?? '', softTissuePhenotype: s?.soft_tissue_phenotype ?? '',
    keratinizedMucosaMm: s?.keratinized_mucosa_mm === null || s?.keratinized_mucosa_mm === undefined ? '' : String(s.keratinized_mucosa_mm),
    flap: s?.flap ?? '', torqueType: s?.torque_type ?? '', healing: s?.healing ?? '', primaryClosure: s?.primary_closure ?? '',
    graftingPerformed: s?.grafting_performed ?? '',
    torque: site.torque_ncm?.toString() ?? '', isq: site.isq?.toString() ?? '', boneType: site.bone_type ?? '',
  });
  const set = (key: keyof typeof v) => (value: string) => setV((cur) => ({ ...cur, [key]: value }));
  const { error, pending, submit } = useSubmit(saveSurgery, onDone);
  const timing = (v.placementTiming || null) as PlacementTiming | null;
  const warning = timingWarning(timing, daysSinceExtraction(v.extractionDate || null, site.placed_on));
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      submit({ siteId: site.id, patientId, expectedUpdatedAt: version, ...v });
    }}>
      <div className="space-y-3">
        <TorqueField value={v.torque} onChange={set('torque')} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Choice label="Torque measured as" value={v.torqueType} onChange={set('torqueType')} values={TORQUE_TYPES} labels={TORQUE_TYPE_LABELS} />
          <Field label="ISQ (optional)">
            <input className="input" inputMode="decimal" value={v.isq} onChange={(e) => set('isq')(e.target.value)} />
          </Field>
          <Field label="Bone type">
            <select className="input" value={v.boneType} onChange={(e) => set('boneType')(e.target.value)}>
              <option value="">— not recorded</option>
              {BONE_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Choice label="Placement timing" value={v.placementTiming} onChange={set('placementTiming')} values={PLACEMENT_TIMINGS} labels={PLACEMENT_TIMING_LABELS} />
        <Field label="Extraction date">
          <input className="input" type="date" value={v.extractionDate} onChange={(e) => set('extractionDate')(e.target.value)} />
        </Field>
      </div>
      {timing && <p className="text-sm text-muted">{PLACEMENT_TIMING_HELP[timing]}</p>}
      {warning && <p className="text-sm text-warn">{warning}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Choice label="Soft-tissue phenotype" value={v.softTissuePhenotype} onChange={set('softTissuePhenotype')} values={PHENOTYPES} labels={PHENOTYPE_LABELS} />
        <Field label="Keratinized mucosa (mm)">
          <input className="input" inputMode="decimal" value={v.keratinizedMucosaMm} onChange={(e) => set('keratinizedMucosaMm')(e.target.value)} />
        </Field>
        <Choice label="Flap" value={v.flap} onChange={set('flap')} values={FLAPS} labels={FLAP_LABELS} />
        <Choice label="Healing" value={v.healing} onChange={set('healing')} values={HEALINGS} labels={HEALING_LABELS} />
        <Choice label="Primary closure" value={v.primaryClosure} onChange={set('primaryClosure')} values={YES_NO} labels={YES_NO_LABELS} />
        <Choice label="Grafting performed" value={v.graftingPerformed} onChange={set('graftingPerformed')} values={YES_NO} labels={YES_NO_LABELS} />
      </div>
      <Footer error={error} pending={pending} saveLabel="Save surgical details" onCancel={onDone} />
    </form>
  );
}

function Grafts({ site, patientId, grafts, editable, canAdd }: {
  site: ImplantSite; patientId: string; grafts: ImplantGraft[]; editable: boolean; canAdd: boolean;
}) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  return (
    <div className="space-y-2">
      <h5 className="font-medium">Grafts</h5>
      {grafts.length === 0 && editing !== 'new' && <p className="text-muted">No graft recorded.</p>}
      <ul className="space-y-1" data-testid="grafts">
        {grafts.map((g) => (
          <li key={g.id}>
            {editing === g.id ? (
              <GraftForm site={site} patientId={patientId} graft={g} onDone={() => setEditing(null)} />
            ) : (
              <GraftRow graft={g} patientId={patientId} editable={editable} onEdit={() => setEditing(g.id)} />
            )}
          </li>
        ))}
      </ul>
      {editing === 'new' && <GraftForm site={site} patientId={patientId} graft={null} onDone={() => setEditing(null)} />}
      {canAdd && editing === null && (
        <button type="button" className="btn-secondary btn" onClick={() => setEditing('new')}>Add graft</button>
      )}
    </div>
  );
}

function GraftRow({ graft, patientId, editable, onEdit }: { graft: ImplantGraft; patientId: string; editable: boolean; onEdit: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function remove() {
    setError(null);
    start(async () => {
      const result = await deleteGraft({ patientId, graftId: graft.id });
      if (result.error) setError(result.error);
    });
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span>{describeGraft(graft)}</span>
      {graft.notes && <span className="text-muted">— {graft.notes}</span>}
      {editable && !confirming && (
        <>
          <button type="button" className="btn-secondary btn" onClick={onEdit}>Edit graft</button>
          <button type="button" className="btn-secondary btn" onClick={() => setConfirming(true)}>Delete graft</button>
        </>
      )}
      {editable && confirming && (
        <>
          <button type="button" className="btn-danger btn" disabled={pending} onClick={remove}>Confirm delete</button>
          <button type="button" className="btn-secondary btn" onClick={() => setConfirming(false)}>Keep</button>
        </>
      )}
      {error && <p role="alert" className="w-full text-bad">{error}</p>}
    </div>
  );
}

function GraftForm({ site, patientId, graft, onDone }: { site: ImplantSite; patientId: string; graft: ImplantGraft | null; onDone: () => void }) {
  const [v, setV] = useState({
    procedure: graft?.procedure ?? '', timing: graft?.timing ?? '', performedOn: graft?.performed_on ?? '',
    material: graft?.material ?? '', product: graft?.product ?? '', membrane: graft?.membrane ?? '', notes: graft?.notes ?? '',
  });
  const set = (key: keyof typeof v) => (value: string) => setV((cur) => ({ ...cur, [key]: value }));
  const { error, pending, submit } = useSubmit(saveGraft, onDone);
  return (
    <form className="space-y-3 rounded-lg border border-line p-3" onSubmit={(e) => {
      e.preventDefault();
      submit({ graftId: graft?.id ?? '', siteId: site.id, patientId, ...v });
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Procedure" required>
          <select className="input" aria-required="true" value={v.procedure} onChange={(e) => set('procedure')(e.target.value)}>
            <option value="">Choose…</option>
            {GRAFT_PROCEDURES.map((p) => <option key={p} value={p}>{GRAFT_PROCEDURE_LABELS[p]}</option>)}
          </select>
        </Field>
        <Field label="Graft timing" required>
          <select className="input" aria-required="true" value={v.timing} onChange={(e) => set('timing')(e.target.value)}>
            <option value="">Choose…</option>
            {GRAFT_TIMINGS.map((t) => <option key={t} value={t}>{GRAFT_TIMING_LABELS[t]}</option>)}
          </select>
        </Field>
        {v.timing === 'staged' && (
          <Field label="Graft date">
            <input className="input" type="date" aria-required="true" value={v.performedOn} onChange={(e) => set('performedOn')(e.target.value)} />
          </Field>
        )}
        <Choice label="Material" value={v.material} onChange={set('material')} values={GRAFT_MATERIALS} labels={GRAFT_MATERIAL_LABELS} />
        <Field label="Product">
          <input className="input" value={v.product} maxLength={120} onChange={(e) => set('product')(e.target.value)} />
        </Field>
        <Choice label="Membrane" value={v.membrane} onChange={set('membrane')} values={MEMBRANES} labels={MEMBRANE_LABELS} />
      </div>
      <Field label="Graft notes">
        <input className="input" value={v.notes} maxLength={500} onChange={(e) => set('notes')(e.target.value)} />
      </Field>
      <Footer error={error} pending={pending} saveLabel="Save graft" onCancel={onDone} />
    </form>
  );
}
