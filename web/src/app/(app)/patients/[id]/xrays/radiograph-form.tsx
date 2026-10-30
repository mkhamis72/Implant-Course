'use client';

import { useState } from 'react';
import { earliestDate, todayIso } from '@/lib/dates';
import { ARCH_ORDER } from '@/lib/restorations/restorations';
import {
  MEASURABLE_STATES, RADIOGRAPH_PURPOSES, RADIOGRAPH_PURPOSE_LABELS, RADIOGRAPH_TYPES, RADIOGRAPH_TYPE_LABELS,
  BONE_LEVEL_MAX, BONE_LEVEL_MIN, XRAY_COVERAGES, XRAY_COVERAGE_LABELS, coverageOf, teethForCoverage,
  type Radiograph, type XrayCoverage,
} from '@/lib/radiographs/radiographs';
import { Field, Footer, useSubmit } from '../implant-forms';
import { saveRadiograph } from './actions';

export type XraySite = { id: string; tooth: number; state: string; placed_on: string | null };

const text = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

/** Adds an X-ray, or edits one (with the version it opened with), with optional bone levels for the implants on its teeth. */
export function RadiographForm({ patientId, sites, radiograph, prefillTeeth, onDone }: {
  patientId: string; sites: XraySite[]; radiograph?: Radiograph; prefillTeeth?: number[]; onDone: () => void;
}) {
  const [version] = useState(radiograph?.updated_at ?? '');
  const [v, setV] = useState({
    takenOn: radiograph?.taken_on ?? todayIso(), type: radiograph?.type ?? '', purpose: radiograph?.purpose ?? '',
    link: radiograph?.link ?? '', notes: radiograph?.notes ?? '',
  });
  const [teeth, setTeeth] = useState<number[]>(radiograph?.teeth ?? prefillTeeth ?? []);
  const [coverage, setCoverage] = useState<XrayCoverage>(() => coverageOf(teeth));
  // Only a planning X-ray may come before the implants on its teeth were placed (0075).
  const firstPlaced = v.purpose && v.purpose !== 'planning' ? earliestDate(sites.filter((s) => teeth.includes(s.tooth) && (v.purpose === 'other' || (MEASURABLE_STATES as readonly string[]).includes(s.state))).map((s) => s.placed_on)) : undefined;
  const [levels, setLevels] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const l of radiograph?.levels ?? []) {
      init[`mesial_${l.site}`] = text(l.mesial_mm);
      init[`distal_${l.site}`] = text(l.distal_mm);
    }
    return init;
  });
  const { error, pending, submit } = useSubmit(saveRadiograph, onDone);
  const [blocked, setBlocked] = useState<string | null>(null);

  const rows = sites
    .filter((s) => (MEASURABLE_STATES as readonly string[]).includes(s.state) && teeth.includes(s.tooth))
    .sort((a, b) => a.tooth - b.tooth);
  // A failed implant and its replacement can share a tooth: name the failed one.
  const rowLabel = (s: XraySite) =>
    s.state === 'failed' && rows.some((o) => o.id !== s.id && o.tooth === s.tooth) ? `${s.tooth} (failed)` : String(s.tooth);
  const hasLevel = (id: string) => (levels[`mesial_${id}`] ?? '').trim() !== '' || (levels[`distal_${id}`] ?? '').trim() !== '';

  function toggle(tooth: number) {
    setTeeth((cur) => (cur.includes(tooth) ? cur.filter((t) => t !== tooth) : [...cur, tooth]));
  }

  // Specific teeth keeps what is chosen, so a whole arch can be narrowed down tooth by tooth.
  function chooseCoverage(next: XrayCoverage) {
    setCoverage(next);
    if (next !== 'teeth') setTeeth(teethForCoverage(next));
  }

  return (
    <form className="card space-y-3" onSubmit={(e) => {
      e.preventDefault();
      // Dropping a measured tooth would delete its bone level, so the measurement has to be cleared first.
      const dropped = sites.find((s) => !teeth.includes(s.tooth) && hasLevel(s.id));
      if (dropped) {
        setBlocked(`Clear the bone level for tooth ${dropped.tooth} before removing it from the X-ray.`);
        return;
      }
      setBlocked(null);
      const measured: Record<string, string> = {};
      for (const s of rows) {
        measured[`mesial_${s.id}`] = levels[`mesial_${s.id}`] ?? '';
        measured[`distal_${s.id}`] = levels[`distal_${s.id}`] ?? '';
      }
      submit({
        patientId, ...(radiograph ? { id: radiograph.id, expectedUpdatedAt: version } : {}), ...v,
        teeth: [...teeth].sort((a, b) => a - b), ...measured,
      });
    }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Date" required>
          <input className="input" type="date" aria-required="true" min={firstPlaced} max={todayIso()} value={v.takenOn} onChange={(e) => setV({ ...v, takenOn: e.target.value })} />
        </Field>
        <Field label="Type" required>
          <select className="input" aria-required="true" value={v.type} onChange={(e) => {
            setV({ ...v, type: e.target.value as typeof v.type });
            if (e.target.value === 'panoramic') chooseCoverage('full');
          }}>
            <option value="">Choose…</option>
            {RADIOGRAPH_TYPES.map((t) => <option key={t} value={t}>{RADIOGRAPH_TYPE_LABELS[t]}</option>)}
          </select>
        </Field>
        <Field label="Purpose" required>
          <select className="input" aria-required="true" value={v.purpose} onChange={(e) => setV({ ...v, purpose: e.target.value as typeof v.purpose })}>
            <option value="">Choose…</option>
            {RADIOGRAPH_PURPOSES.map((p) => <option key={p} value={p}>{RADIOGRAPH_PURPOSE_LABELS[p]}</option>)}
          </select>
        </Field>
      </div>

      <fieldset className="space-y-2">
        <legend className="label">Teeth shown <span aria-hidden="true" className="text-bad">*</span></legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {XRAY_COVERAGES.map((c) => (
            <label key={c} className="flex items-center gap-1 text-sm">
              <input type="radio" name="coverage" checked={coverage === c} onChange={() => chooseCoverage(c)} />
              {XRAY_COVERAGE_LABELS[c]}
            </label>
          ))}
        </div>
        {coverage === 'teeth' && (['upper', 'lower'] as const).map((jaw) => (
          <div key={jaw} className="flex flex-wrap gap-1">
            {ARCH_ORDER[jaw].map((t) => (
              <label key={t} className="flex items-center gap-1 rounded border border-line px-1.5 py-1 text-sm">
                <input type="checkbox" checked={teeth.includes(t)} onChange={() => toggle(t)} />
                {t}
              </label>
            ))}
          </div>
        ))}
      </fieldset>

      <Field label="Link to the image">
        <input className="input" type="url" maxLength={2000} placeholder="https://…" value={v.link} onChange={(e) => setV({ ...v, link: e.target.value })} />
      </Field>
      <Field label="Notes">
        <input className="input" maxLength={1000} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
      </Field>

      {rows.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="label">Bone levels (optional)</legend>
          <p className="text-sm text-muted">
            Distance from the implant shoulder to the first bone contact. + = bone below the shoulder; leave blank if not measured.
          </p>
          {rows.map((s) => (
            <div key={s.id} className="grid grid-cols-[3rem_1fr_1fr] items-center gap-2" data-testid="bone-level-row">
              <span className="font-medium">{rowLabel(s)}</span>
              {(['mesial', 'distal'] as const).map((side) => (
                <input
                  key={side}
                  className="input"
                  type="number"
                  step={0.1}
                  min={BONE_LEVEL_MIN}
                  max={BONE_LEVEL_MAX}
                  placeholder={side === 'mesial' ? 'Mesial mm' : 'Distal mm'}
                  aria-label={`${side === 'mesial' ? 'Mesial' : 'Distal'} ${rowLabel(s)}`}
                  value={levels[`${side}_${s.id}`] ?? ''}
                  onChange={(e) => setLevels({ ...levels, [`${side}_${s.id}`]: e.target.value })}
                />
              ))}
            </div>
          ))}
        </fieldset>
      )}
      <Footer error={blocked ?? error} pending={pending} saveLabel="Save X-ray" onCancel={onDone} />
    </form>
  );
}
