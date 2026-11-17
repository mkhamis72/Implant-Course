'use client';

import { useState, useTransition } from 'react';
import { acceptsProduct, currentComponent } from '@/lib/inventory/components';
import { delegatesForCourse, keepIfEnrolled, withRecordedDelegate } from '@/lib/inventory/enrolled';
import { lotLabel, productLabel } from '@/lib/inventory/labels';
import { COMPONENT_LABELS, type ChartData, type ImplantSite, type LotOnHand } from '@/lib/inventory/types';
import { formatDate } from '@/lib/format';
import { CourseOptions, NoneEnrolled, PlacedByChoice, type PlacedBy } from './implant-forms';
import { visitResult } from '@/lib/visits/visits';
import { correctBatch, correctPlacement, removePlacement, voidComponent, voidFollowup } from './implant-actions';

type Result = { error?: string };

function useRun() {
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>) => {
    setError(null);
    setOk(null);
    start(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else setOk('Correction saved.');
    });
  };
  return { error, ok, pending, run };
}

/** Batches a correction may point to: in stock, other than the current one, and not expired on the day of use. */
function correctionLots(
  lots: readonly LotOnHand[], productId: string, currentLotId: string | null, usedOn: string | null, includeEmpty = false,
): LotOnHand[] {
  return lots.filter(
    (l) =>
      l.product_id === productId && (includeEmpty || l.on_hand > 0) && l.stock_lot_id !== currentLotId &&
      !(l.expiry && usedOn && l.expiry < usedOn),
  );
}

type Option = { id: string; label: string };

/** The active options, plus the one already recorded if it has since become inactive. */
function withRecorded(options: Option[], id: string | null, name: string | null | undefined): Option[] {
  if (!id || options.some((o) => o.id === id)) return options;
  return [...options, { id, label: `${name ?? 'Unknown'} (inactive)` }];
}

/** Date, people and clinical values of a placed implant, prefilled from what was recorded. */
function PlacementDetails({ patientId, site, data, run, pending }: {
  patientId: string; site: ImplantSite; data: ChartData; run: (fn: () => Promise<Result>) => void; pending: boolean;
}) {
  const teaching = data.teachingOn;
  const [placedBy, setPlacedBy] = useState<PlacedBy>(!teaching || site.placing_doctor_id ? 'doctor' : 'delegate');
  const [v, setV] = useState({
    placedOn: site.placed_on ?? '',
    placingDelegateId: site.placing_delegate_id ?? '',
    placingDoctorId: site.placing_doctor_id ?? '',
    assistingDelegateId: site.assisting_delegate_id ?? '',
    supervisorId: site.supervisor_id ?? '',
    courseId: site.course_id ?? '',
    graft: site.graft ?? '',
    notes: site.notes ?? '',
  });
  const set = (key: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV((cur) => ({
      ...cur,
      [key]: e.target.value,
      ...(key === 'courseId' ? {
        placingDelegateId: keepIfEnrolled(data.enrollments, e.target.value, cur.placingDelegateId),
        assistingDelegateId: keepIfEnrolled(data.enrollments, e.target.value, cur.assistingDelegateId),
      } : {}),
    }));
  const enrolled = delegatesForCourse(data.delegates, data.enrollments, v.courseId);
  const delegates = withRecordedDelegate(
    withRecordedDelegate(enrolled, data.delegates, v.placingDelegateId, site.placing?.full_name),
    data.delegates,
    v.assistingDelegateId,
    site.assisting?.full_name,
  );
  const supervisors = withRecorded(data.supervisors, site.supervisor_id, site.supervisor?.full_name);
  const doctors = withRecorded(data.doctors.map((d) => ({ id: d.id, label: d.name })), site.placing_doctor_id, site.doctor?.name);
  const byDoctor = placedBy === 'doctor';
  const doctorSelect = (label: string) => (
    <label className="block">
      <span className="label">{label}</span>
      <select className="input" value={v.placingDoctorId} onChange={set('placingDoctorId')}>
        <option value="">Choose the doctor…</option>
        {doctors.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
      </select>
    </label>
  );
  const values = teaching
    ? { ...v, placedBy, placingDelegateId: byDoctor ? null : v.placingDelegateId, placingDoctorId: byDoctor ? v.placingDoctorId : null }
    // A clinic records only the doctor.
    : { ...v, placedBy, placingDelegateId: null, assistingDelegateId: null, supervisorId: null, courseId: null };
  return (
    <div className="space-y-2" role="group" aria-label="Placement details">
      <p className="font-medium">Placement details</p>
      {teaching && <PlacedByChoice value={placedBy} onChange={setPlacedBy} />}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="label">Placement date</span>
          <input className="input" type="date" max={data.today} value={v.placedOn} onChange={set('placedOn')} />
        </label>
        {!teaching ? doctorSelect('Placed by') : (
          <>
            {byDoctor ? doctorSelect('Doctor') : (
              <label className="block">
                <span className="label">Placed by (delegate)</span>
                <select className="input" value={v.placingDelegateId} onChange={set('placingDelegateId')}>
                  <option value="">Choose the delegate…</option>
                  {delegates.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
              </label>
            )}
            <label className="block">
              <span className="label">Assisted by</span>
              <select className="input" value={v.assistingDelegateId} onChange={set('assistingDelegateId')}>
                <option value="">Nobody</option>
                {delegates.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">{byDoctor ? 'Supervisor (optional)' : 'Supervisor'}</span>
              <select className="input" value={v.supervisorId} onChange={set('supervisorId')}>
                <option value="">{byDoctor ? 'No supervisor' : 'Choose the supervisor…'}</option>
                {supervisors.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">Course</span>
              <select className="input" value={v.courseId} onChange={set('courseId')}>
                <option value="">Choose the course…</option>
                <CourseOptions courses={data.courses} date={v.placedOn} />
              </select>
            </label>
          </>
        )}
      </div>
      {teaching && <NoneEnrolled courseId={v.courseId} delegates={delegates} />}
      <label className="block">
        <span className="label">Notes</span>
        <input className="input" value={v.notes} onChange={set('notes')} />
      </label>
      <button
        type="button"
        className="btn-secondary btn"
        disabled={pending}
        onClick={() => run(() => correctPlacement({ siteId: site.id, patientId, ...values }))}
      >
        Save details
      </button>
    </div>
  );
}

/** What removing a mistaken placement takes with it, e.g. "2 components and 1 follow-up visit". */
export function removalSummary(site: Pick<ImplantSite, 'components' | 'followups'>): string {
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  const components = site.components.filter((c) => !c.voided_at).length;
  const visits = site.followups.filter((f) => !f.voided_at).length;
  return [components && plural(components, 'component'), visits && plural(visits, 'follow-up visit')]
    .filter(Boolean)
    .join(' and ');
}

/** Removes an implant entered by mistake (wrong tooth or patient), after a reason and a second click. */
function RemovePlacement({ site, reason, setReason, confirming, setConfirming, pending, onRemove }: {
  site: ImplantSite;
  reason: string;
  setReason: (v: string) => void;
  confirming: boolean;
  setConfirming: (v: boolean) => void;
  pending: boolean;
  onRemove: () => void;
}) {
  if (!['placed', 'restored', 'failed'].includes(site.state)) return null;
  const extra = removalSummary(site);
  return (
    <div className="space-y-2 border-t border-line pt-4">
      <p className="font-medium">Entered by mistake?</p>
      <p className="text-muted">
        Removes this implant from tooth {site.tooth}
        {extra ? `, with its ${extra} and everything else recorded on it` : ' and everything recorded on it'}. Its stock goes
        back to inventory, as if it was never entered. Use this for a wrong tooth or a wrong (duplicate) patient, then place it
        again on the right one.
      </p>
      <label className="block">
        <span className="label">Reason for removing the implant</span>
        <input className="input" value={reason} onChange={(e) => { setReason(e.target.value); setConfirming(false); }} />
      </label>
      {confirming ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-danger btn" disabled={pending} onClick={onRemove}>
            Yes, remove the implant on tooth {site.tooth}
          </button>
          <button type="button" className="btn-secondary btn" disabled={pending} onClick={() => setConfirming(false)}>
            Keep it
          </button>
        </div>
      ) : (
        <button type="button" className="btn-secondary btn" disabled={pending} onClick={() => setConfirming(true)}>
          Remove implant
        </button>
      )}
    </div>
  );
}

/** bare: inside the Corrections tab (no collapsible wrapper). */
function Shell({ bare, children }: { bare: boolean; children: React.ReactNode }) {
  if (bare) return <div className="text-sm">{children}</div>;
  return (
    <details className="rounded border border-line p-2 text-sm">
      <summary className="cursor-pointer font-medium">Corrections</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

export function Corrections({ patientId, site, data, bare = false }: { patientId: string; site: ImplantSite; data: ChartData; bare?: boolean }) {
  const { error, ok, pending, run } = useRun();
  const stockComponents = site.components.filter((c) => !c.voided_at && c.product);
  const [target, setTarget] = useState('implant');
  const component = stockComponents.find((c) => c.id === target) ?? null;
  const currentProductId = component ? component.product!.id : (site.product?.id ?? '');
  const [productId, setProductId] = useState(currentProductId);
  const [lotId, setLotId] = useState('');
  const [batchReason, setBatchReason] = useState('');
  const [resetKey, setResetKey] = useState(0);
  const [followupReason, setFollowupReason] = useState('');
  const [componentReason, setComponentReason] = useState('');
  const [removeReason, setRemoveReason] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);

  const current = currentComponent(site);
  const products = component
    ? data.componentProducts.filter((p) => acceptsProduct(component.component_type, p.type))
    : data.implants;
  const productOptions = products.some((p) => p.id === currentProductId) || !currentProductId
    ? products
    : [...products, (component ? component.product : site.product)!];
  const currentLotId = component ? component.stock_lot_id : site.stock_lot_id;
  const usedOn = component ? component.fitted_on : site.placed_on;
  const hasLot = !!currentLotId;
  const lots = correctionLots(data.lots, productId, currentLotId, usedOn, !hasLot);
  const sendCorrection = (newLotId: string | null) => {
    if (hasLot && !newLotId) return run(async () => ({ error: 'Choose the correct batch.' }));
    return run(async () => {
      const r = await correctBatch({
        siteId: site.id,
        patientId,
        componentId: component?.id ?? '',
        newProductId: productId !== currentProductId ? productId : '',
        newLotId,
        reason: batchReason,
      });
      if (!r.error) {
        setLotId('');
        setBatchReason('');
        setResetKey((k) => k + 1);
      }
      return r;
    });
  };
  const latest = site.followups.filter((f) => !f.voided_at).at(-1);

  function chooseTarget(value: string) {
    setTarget(value);
    const c = stockComponents.find((x) => x.id === value);
    setProductId(c ? c.product!.id : (site.product?.id ?? ''));
    setLotId('');
  }

  return (
    <Shell bare={bare}>
      <div className="space-y-4">
        <PlacementDetails patientId={patientId} site={site} data={data} run={run} pending={pending} />
        {site.product && (
          <div className="space-y-2">
            <label className="block">
              <span className="label">What to correct</span>
              <select className="input" value={target} onChange={(e) => chooseTarget(e.target.value)}>
                <option value="implant">The implant</option>
                {stockComponents.map((c) => (
                  <option key={c.id} value={c.id}>
                    {COMPONENT_LABELS[c.component_type]} ({formatDate(c.fitted_on)})
                  </option>
                ))}
              </select>
            </label>
            {hasLot && !data.inventoryOn ? (
              <p className="text-muted">Switch Inventory on to correct the stock batch.</p>
            ) : (
              <>
                <label key={`product-${resetKey}`} className="block">
                  <span className="label">Product actually used</span>
                  <select className="input" value={productId} onChange={(e) => { setProductId(e.target.value); setLotId(''); }}>
                    {productOptions.map((p) => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
                  </select>
                </label>
                {(hasLot || data.inventoryOn) && (
                  <label key={`lot-${resetKey}`} className="block">
                    <span className="label">{hasLot ? 'Correct batch' : 'Stock batch'}</span>
                    <select className="input" value={lotId} onChange={(e) => setLotId(e.target.value)}>
                      <option value="">{hasLot ? 'Choose the batch actually used…' : 'Choose the batch used…'}</option>
                      {lots.map((l) => <option key={l.stock_lot_id} value={l.stock_lot_id}>{lotLabel(l)}</option>)}
                    </select>
                  </label>
                )}
                <label key={`reason-${resetKey}`} className="block">
                  <span className="label">Reason for correction</span>
                  <input className="input" value={batchReason} onChange={(e) => setBatchReason(e.target.value)} />
                </label>
                {hasLot ? (
                  <button type="button" className="btn-secondary btn" disabled={pending} onClick={() => sendCorrection(lotId)}>
                    Correct batch
                  </button>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary btn" disabled={pending || (productId === currentProductId && !!currentProductId)} onClick={() => sendCorrection(null)}>
                      Correct product
                    </button>
                    {data.inventoryOn && (
                      <button type="button" className="btn-secondary btn" disabled={pending || !lotId} onClick={() => sendCorrection(lotId)}>
                        Attach stock batch
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {current && site.state !== 'failed' && (
          <div className="space-y-2">
            <p>Current component: {COMPONENT_LABELS[current.component_type]} ({formatDate(current.fitted_on)})</p>
            <label className="block">
              <span className="label">Reason for undoing the component</span>
              <input className="input" value={componentReason} onChange={(e) => setComponentReason(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn-secondary btn"
              disabled={pending}
              onClick={() => run(() => voidComponent({ id: current.id, patientId, reason: componentReason }))}
            >
              Undo current component
            </button>
          </div>
        )}
        {latest && (
          <div className="space-y-2">
            <p>
              Latest follow-up: {formatDate(latest.date)} · {latest.check_type} · {visitResult(latest)}
            </p>
            <label className="block">
              <span className="label">Reason for removing the follow-up</span>
              <input className="input" value={followupReason} onChange={(e) => setFollowupReason(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn-secondary btn"
              disabled={pending}
              onClick={() => run(() => voidFollowup({ id: latest.id, patientId, reason: followupReason }))}
            >
              Remove follow-up
            </button>
          </div>
        )}
        <RemovePlacement
          site={site}
          reason={removeReason}
          setReason={setRemoveReason}
          confirming={confirmRemove}
          setConfirming={setConfirmRemove}
          pending={pending}
          onRemove={() => run(() => removePlacement({ id: site.id, patientId, reason: removeReason }))}
        />
        {error && <p role="alert" className="text-bad">{error}</p>}
        {ok && <p role="status" className="text-ok">{ok}</p>}
      </div>
    </Shell>
  );
}
