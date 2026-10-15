'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { availableLots } from '@/lib/inventory/lots';
import { lotLabel, productLabel } from '@/lib/inventory/labels';
import { acceptsProduct } from '@/lib/inventory/components';
import { BONE_TYPES } from '@/lib/inventory/schemas';
import {
  COMPONENT_LABELS, COMPONENT_TYPES, FOLLOWUP_OUTCOMES, OUTCOME_LABELS, TECHNIQUES, TECHNIQUE_LABELS,
  type ChartData, type ComponentType, type ImplantSite, type Technique,
} from '@/lib/inventory/types';
import { fitComponent, placeImplant, planImplant, receiveStockForPlacement, recordFollowup } from './implant-actions';
import { ImplantPicker } from './implant-picker';

type Result = { error?: string };

function useSubmit(action: (input: Record<string, unknown>) => Promise<Result>, onDone: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit(input: Record<string, unknown>) {
    setError(null);
    start(async () => {
      const result = await action(input);
      if (result.error) setError(result.error);
      else onDone();
    });
  }
  return { error, pending, submit };
}

/** A labelled field; required fields carry a visual mark (screen readers get aria-required on the control). */
function Field({ label, required = false, children }: { label: string; required?: boolean; children: React.ReactNode }) {
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

/** Guided or free-hand surgery; required when planning or placing. */
export function TechniqueField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Technique" required>
      <select className="input" aria-required="true" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose Guided or Free hand…</option>
        {TECHNIQUES.map((t) => <option key={t} value={t}>{TECHNIQUE_LABELS[t]}</option>)}
      </select>
    </Field>
  );
}

function Footer({ error, pending, saveLabel, onCancel }: { error: string | null; pending: boolean; saveLabel: string; onCancel: () => void }) {
  return (
    <>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      {/* On phones the save bar stays in reach at the bottom of the screen while the form scrolls. */}
      <div className="sticky bottom-0 -mx-1 flex gap-2 bg-surface px-1 py-2 sm:static sm:mx-0 sm:px-0 sm:py-0">
        <button className="btn flex-1 sm:flex-none" disabled={pending}>
          {saveLabel}
        </button>
        <button type="button" className="btn-secondary btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </>
  );
}

/** The chosen batch, or '' if it can't be used on that date (e.g. the date moved past its expiry). */
function keepIfUsable(data: ChartData, productId: string, lotId: string, usedOn: string): string {
  return availableLots(data.lots, productId, usedOn).some((l) => l.stock_lot_id === lotId) ? lotId : '';
}

/**
 * Receives a delivery without leaving the placement form (a <div>, since forms can't nest): Enter and
 * the Receive button send only these fields, and the new batch is then selected.
 */
function ReceiveHere({ patientId, productId, today, onReceived }: {
  patientId: string; productId: string; today: string; onReceived: (lotId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ quantity: '', lot_no: '', expiry: '', received_on: today });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const field = (key: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((cur) => ({ ...cur, [key]: e.target.value }));
  function receive() {
    setError(null);
    start(async () => {
      const result = await receiveStockForPlacement(patientId, { product_id: productId, ...f });
      if (result.error) setError(result.error);
      else if (result.lotId) {
        setOpen(false);
        onReceived(result.lotId);
      }
    });
  }
  if (!open) {
    return (
      <button type="button" className="btn-secondary btn" onClick={() => setOpen(true)}>
        Receive stock here
      </button>
    );
  }
  return (
    <div
      role="group"
      aria-label="Receive stock"
      className="space-y-2 rounded-lg border border-line-strong bg-sunken p-3"
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); receive(); } }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Quantity" required>
          <input className="input" inputMode="numeric" aria-required="true" value={f.quantity} onChange={field('quantity')} />
        </Field>
        <Field label="Lot number (optional)">
          <input className="input" value={f.lot_no} onChange={field('lot_no')} />
        </Field>
        <Field label="Expiry (optional)">
          <input className="input" type="date" value={f.expiry} onChange={field('expiry')} />
        </Field>
        <Field label="Received on" required>
          <input className="input" type="date" aria-required="true" value={f.received_on} onChange={field('received_on')} />
        </Field>
      </div>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn" disabled={pending} onClick={receive}>Receive</button>
        <button type="button" className="btn-secondary btn" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

type Receive = { patientId: string; canReceive: boolean; onReceived: (lotId: string) => void };

/**
 * Batches are offered by whether they were in date on the day of use, not on today's date. With
 * `receive` (the placement form), missing stock is received in place; otherwise a link to Inventory.
 */
function BatchSelect({ data, productId, usedOn, value, onChange, receive }: {
  data: ChartData; productId: string; usedOn: string; value: string; onChange: (v: string) => void; receive?: Receive;
}) {
  const lots = productId ? availableLots(data.lots, productId, usedOn || data.today) : [];
  if (productId && lots.length === 0) {
    if (receive) {
      return (
        <div className="space-y-2">
          <p className="text-sm text-warn">
            No usable stock for this product.
            {!receive.canReceive && ' Ask someone with Inventory access to receive it.'}
          </p>
          {receive.canReceive && (
            <ReceiveHere patientId={receive.patientId} productId={productId} today={data.today} onReceived={receive.onReceived} />
          )}
        </div>
      );
    }
    return (
      <p className="text-sm text-warn">
        No usable stock for this product.{' '}
        <Link href={`/inventory/receive?product=${productId}`} className="text-accent underline">
          Receive stock
        </Link>
      </p>
    );
  }
  if (!productId) return null;
  // One tap per batch: usable batches as cards, soonest expiry first (availableLots' order).
  return (
    <fieldset>
      <legend className="label">
        Stock batch<span aria-hidden="true" className="text-bad"> *</span>
      </legend>
      <div role="radiogroup" aria-label="Stock batch" aria-required="true" className="grid gap-2 sm:grid-cols-2">
        {lots.map((l) => {
          const checked = value === l.stock_lot_id;
          return (
            <label
              key={l.stock_lot_id}
              className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                checked ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface hover:bg-sunken'
              }`}
            >
              <input
                type="radio"
                name="stock-batch"
                className="mt-1"
                value={l.stock_lot_id}
                checked={checked}
                onChange={() => onChange(l.stock_lot_id)}
                aria-label={lotLabel(l)}
              />
              <span>
                <span className="block font-semibold">{l.lot_no ? `Lot ${l.lot_no}` : 'No lot'}</span>
                <span className="block text-muted">
                  {l.expiry ? `exp ${l.expiry}` : 'no expiry'} · {l.on_hand} left
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

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

const nameOf = (options: { id: string; label: string }[], id: string) => options.find((o) => o.id === id)?.label ?? null;

/**
 * Who placed, assisted and supervised. For a booked implant these come from the booking, so they
 * show as one line with the dropdowns folded away under "Change".
 */
function People({ booked, summary, children }: { booked: boolean; summary: (string | null)[]; children: React.ReactNode }) {
  if (!booked) return <>{children}</>;
  return (
    <div className="rounded-lg border border-line bg-sunken px-3 py-2 text-sm">
      <p data-testid="booked-people">{summary.filter(Boolean).join(', ')}</p>
      <details className="mt-1">
        <summary className="cursor-pointer text-accent">Change</summary>
        <div className="mt-2 space-y-3">{children}</div>
      </details>
    </div>
  );
}

type Base = { patientId: string; tooth: number; data: ChartData; onDone: () => void };

export function PlanForm({ patientId, tooth, data, onDone }: Base) {
  const [productId, setProductId] = useState('');
  const [technique, setTechnique] = useState('');
  const [notes, setNotes] = useState('');
  const { error, pending, submit } = useSubmit(planImplant, onDone);
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit({ patientId, tooth, productId, technique, notes }); }}>
      <ImplantPicker implants={data.implants} lots={data.lots} usedOn={data.today} value={productId} onChange={setProductId} inStockDefault={false} />
      <TechniqueField value={technique} onChange={setTechnique} />
      <Field label="Notes (optional)">
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <Footer error={error} pending={pending} saveLabel="Save plan" onCancel={onDone} />
    </form>
  );
}

export function PlaceForm({
  patientId,
  tooth,
  data,
  onDone,
  plannedProductId,
  plannedTechnique = null,
  slot = null,
}: Base & { plannedProductId: string | null; plannedTechnique?: Technique | null; slot?: ImplantSite['slot'] }) {
  // A booked implant starts with the booking's delegates and supervisor.
  const placingFromSlot = slot?.delegates.find((d) => d.role === 'placing')?.delegate_id ?? '';
  const assistingFromSlot = slot?.delegates.find((d) => d.role === 'assisting')?.delegate_id ?? '';
  const [v, setV] = useState({
    productId: plannedProductId ?? '', technique: plannedTechnique ?? '', lotId: '', placedOn: data.today,
    placingDelegateId: placingFromSlot, assistingDelegateId: assistingFromSlot,
    supervisorId: slot?.supervisor_id ?? (data.supervisors.some((s) => s.id === data.me) ? data.me : ''), torque: '', isq: '', boneType: '', graft: '', notes: '',
  });
  const set = (key: keyof typeof v) => (value: string) =>
    setV((cur) => ({
      ...cur,
      [key]: value,
      ...(key === 'productId' ? { lotId: '' } : {}),
      ...(key === 'placedOn' ? { lotId: keepIfUsable(data, cur.productId, cur.lotId, value) } : {}),
    }));
  const { error, pending, submit } = useSubmit(placeImplant, onDone);
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit({ patientId, tooth, slotId: slot?.id ?? '', ...v }); }}>
      <p className="text-xs text-muted"><span aria-hidden="true" className="text-bad">*</span> Required</p>
      <ImplantPicker
        implants={data.implants}
        lots={data.lots}
        usedOn={v.placedOn}
        value={v.productId}
        onChange={set('productId')}
        required
        // A planned implant with no stock stays visible: the box starts unticked so it can be received.
        inStockDefault={!plannedProductId || availableLots(data.lots, plannedProductId, data.today).length > 0}
      />
      <BatchSelect
        data={data}
        productId={v.productId}
        usedOn={v.placedOn}
        value={v.lotId}
        onChange={set('lotId')}
        receive={{ patientId, canReceive: data.canReceive, onReceived: set('lotId') }}
      />
      <TechniqueField value={v.technique} onChange={set('technique')} />
      <Field label="Placement date" required>
        <input className="input" type="date" aria-required="true" value={v.placedOn} onChange={(e) => set('placedOn')(e.target.value)} />
      </Field>
      <People
        booked={Boolean(placingFromSlot)}
        summary={[
          `Placed by ${nameOf(data.delegates, v.placingDelegateId) ?? '—'}`,
          v.assistingDelegateId ? `assisted by ${nameOf(data.delegates, v.assistingDelegateId)}` : null,
          `supervised by ${nameOf(data.supervisors, v.supervisorId) ?? '—'}`,
        ]}
      >
        <Field label="Placed by (delegate)" required>
          <select className="input" aria-required="true" value={v.placingDelegateId} onChange={(e) => set('placingDelegateId')(e.target.value)}>
            <option value="">Choose the delegate…</option>
            {data.delegates.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </Field>
        <Field label="Assisted by (optional)">
          <select className="input" value={v.assistingDelegateId} onChange={(e) => set('assistingDelegateId')(e.target.value)}>
            <option value="">Nobody</option>
            {data.delegates.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </Field>
        <Field label="Supervisor" required>
          <select className="input" aria-required="true" value={v.supervisorId} onChange={(e) => set('supervisorId')(e.target.value)}>
            <option value="">Choose the supervisor…</option>
            {data.supervisors.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </Field>
      </People>
      <TorqueField value={v.torque} onChange={set('torque')} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="ISQ (optional)">
          <input className="input" inputMode="decimal" value={v.isq} onChange={(e) => set('isq')(e.target.value)} />
        </Field>
        <Field label="Bone type (optional)">
          <select className="input" value={v.boneType} onChange={(e) => set('boneType')(e.target.value)}>
            <option value="">—</option>
            {BONE_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Graft (optional)">
        <input className="input" value={v.graft} onChange={(e) => set('graft')(e.target.value)} />
      </Field>
      <Field label="Notes (optional)">
        <input className="input" value={v.notes} onChange={(e) => set('notes')(e.target.value)} />
      </Field>
      <Footer error={error} pending={pending} saveLabel="Save placement" onCancel={onDone} />
    </form>
  );
}

export function ComponentForm({ patientId, site, data, onDone }: { patientId: string; site: ImplantSite; data: ChartData; onDone: () => void }) {
  const [v, setV] = useState({
    componentType: 'healing_abutment' as ComponentType, productId: '', lotId: '', fittedOn: data.today,
    byDelegateId: '', byOrganizerId: data.me, notes: '',
  });
  const set = (key: keyof typeof v) => (value: string) =>
    setV((cur) => ({
      ...cur,
      [key]: value,
      ...(key === 'componentType' ? { productId: '', lotId: '' } : {}),
      ...(key === 'productId' ? { lotId: '' } : {}),
      ...(key === 'fittedOn' ? { lotId: keepIfUsable(data, cur.productId, cur.lotId, value) } : {}),
    }));
  const products = data.componentProducts.filter((p) => acceptsProduct(v.componentType, p.type));
  const { error, pending, submit } = useSubmit(fitComponent, onDone);
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit({ patientId, siteId: site.id, ...v }); }}>
      <Field label="Component">
        <select className="input" value={v.componentType} onChange={(e) => set('componentType')(e.target.value)}>
          {COMPONENT_TYPES.map((t) => <option key={t} value={t}>{COMPONENT_LABELS[t]}</option>)}
        </select>
      </Field>
      <Field label="Product (optional)">
        <select className="input" value={v.productId} onChange={(e) => set('productId')(e.target.value)}>
          <option value="">{v.componentType === 'final_restoration' ? 'Lab-made / not from stock' : 'Not from stock'}</option>
          {products.map((p) => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
        </select>
      </Field>
      {v.productId && <BatchSelect data={data} productId={v.productId} usedOn={v.fittedOn} value={v.lotId} onChange={set('lotId')} />}
      <Field label="Fitted on">
        <input className="input" type="date" value={v.fittedOn} onChange={(e) => set('fittedOn')(e.target.value)} />
      </Field>
      <Field label="Fitted by (delegate)">
        <select className="input" value={v.byDelegateId} onChange={(e) => set('byDelegateId')(e.target.value)}>
          <option value="">—</option>
          {data.delegates.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
      </Field>
      <Field label="Fitted by (organizer)">
        <select className="input" value={v.byOrganizerId} onChange={(e) => set('byOrganizerId')(e.target.value)}>
          <option value="">—</option>
          {data.organizers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </Field>
      <Field label="Notes (optional)">
        <input className="input" value={v.notes} onChange={(e) => set('notes')(e.target.value)} />
      </Field>
      <Footer error={error} pending={pending} saveLabel="Save component" onCancel={onDone} />
    </form>
  );
}

export function FollowupForm({ patientId, site, data, onDone }: { patientId: string; site: ImplantSite; data: ChartData; onDone: () => void }) {
  const [v, setV] = useState({ date: data.today, checkType: '', outcome: 'ok', notes: '' });
  const set = (key: keyof typeof v) => (value: string) => setV((cur) => ({ ...cur, [key]: value }));
  const { error, pending, submit } = useSubmit(recordFollowup, onDone);
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit({ patientId, siteId: site.id, ...v }); }}>
      <Field label="Date">
        <input className="input" type="date" value={v.date} onChange={(e) => set('date')(e.target.value)} />
      </Field>
      <Field label="Check">
        <input className="input" list="check-types" value={v.checkType} onChange={(e) => set('checkType')(e.target.value)} />
        <datalist id="check-types">
          {['2-week', '6-week', '3-month', '6-month', '1-year'].map((c) => <option key={c} value={c} />)}
        </datalist>
      </Field>
      <Field label="Outcome">
        <select className="input" value={v.outcome} onChange={(e) => set('outcome')(e.target.value)}>
          {FOLLOWUP_OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>)}
        </select>
      </Field>
      <Field label="Notes (optional)">
        <input className="input" value={v.notes} onChange={(e) => set('notes')(e.target.value)} />
      </Field>
      <Footer error={error} pending={pending} saveLabel="Save follow-up" onCancel={onDone} />
    </form>
  );
}
