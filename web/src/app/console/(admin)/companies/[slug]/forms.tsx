'use client';

import { useActionState, useState } from 'react';
import { checkedOf, valueOf, type FormState } from '@/lib/patients/form-state';
import { KIND_LABELS, MODULES, MODULE_LABELS, type CompanyKind, type Module } from '@/lib/modules/modules';
import { TemporaryPassword } from '@/components/temporary-password';
import { addDomain, firstAdmin, setCompanyPlan, setCompanyStatus, updateCompany, type FirstAdminState } from '../../actions';

/** useActionState plus a sequence number carried in each result, so the form remounts (React 19 resets uncontrolled inputs). */
function useRemountingAction(action: (prev: FirstAdminState, formData: FormData) => Promise<FirstAdminState>) {
  const [state, formAction, pending] = useActionState(
    async (prev: FirstAdminState, formData: FormData): Promise<FirstAdminState> => ({ ...(await action(prev, formData)), seq: (prev.seq ?? 0) + 1 }),
    {} as FirstAdminState,
  );
  return { state, formAction, pending, attempt: state.seq ?? 0 };
}

function Messages({ state }: { state: FormState }) {
  return (
    <>
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm text-ok">{state.ok}</p>}
    </>
  );
}

export function DetailsForm({ slug, name, hosts }: { slug: string; name: string; hosts: string[] }) {
  const { state, formAction, pending, attempt } = useRemountingAction(updateCompany);
  return (
    <section className="card">
      <h2 className="mb-3 text-lg font-semibold">Details</h2>
      <form key={attempt} action={formAction} className="space-y-3">
        <input type="hidden" name="slug" value={slug} />
        <div>
          <label className="label" htmlFor="details-name">Name</label>
          <input id="details-name" name="name" className="input" required defaultValue={valueOf(state, 'name', name)} />
        </div>
        <div>
          <label className="label" htmlFor="details-hosts">Addresses (one per line)</label>
          <textarea id="details-hosts" name="hosts" className="input" rows={3} required defaultValue={valueOf(state, 'hosts', hosts.join('\n'))} />
        </div>
        <button className="btn" disabled={pending}>Save</button>
      </form>
      <Messages state={state} />
    </section>
  );
}

type PlanChoice = { id: string; name: string; kind: CompanyKind };

/** The company's type, plan and extra modules. Release 1: only Course organizer, Inventory always on. */
export function PlanForm({ slug, kind, planId, extras, plans }: { slug: string; kind: CompanyKind; planId: string; extras: Module[]; plans: PlanChoice[] }) {
  const { state, formAction, pending, attempt } = useRemountingAction(setCompanyPlan);
  return (
    <section className="card">
      <h2 className="mb-3 text-lg font-semibold">Plan</h2>
      <PlanFields key={attempt} slug={slug} state={state} formAction={formAction} pending={pending} kind={kind} planId={planId} extras={extras} plans={plans} />
      <Messages state={state} />
    </section>
  );
}

function PlanFields({ slug, state, formAction, pending, kind, planId, extras, plans }: {
  slug: string; state: FormState; formAction: (f: FormData) => void; pending: boolean;
  kind: CompanyKind; planId: string; extras: Module[]; plans: PlanChoice[];
}) {
  const [chosen, setChosen] = useState<CompanyKind>((valueOf(state, 'kind', kind) as CompanyKind) || kind);
  const ofKind = plans.filter((p) => p.kind === chosen);
  const wanted = valueOf(state, 'plan_id', planId);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="plan-kind">Type</label>
          <select id="plan-kind" name="kind" className="input" value={chosen} onChange={(e) => setChosen(e.target.value as CompanyKind)}>
            <option value="course_organizer">{KIND_LABELS.course_organizer}</option>
            <option value="clinic" disabled>{KIND_LABELS.clinic} (later release)</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="plan-plan">Plan</label>
          <select id="plan-plan" name="plan_id" className="input" required defaultValue={ofKind.some((p) => p.id === wanted) ? wanted : ''}>
            <option value="" disabled>Choose a plan</option>
            {ofKind.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      <fieldset>
        <legend className="label">Extra modules (on top of the plan)</legend>
        <div className="flex flex-wrap gap-4">
          {MODULES.map((m) =>
            m === 'inventory' ? (
              <label key={m} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked disabled readOnly /> {MODULE_LABELS[m]} <span className="text-muted">Always on for now</span>
              </label>
            ) : (
              <label key={m} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={`extra_${m}`} defaultChecked={checkedOf(state, `extra_${m}`, extras.includes(m))} /> {MODULE_LABELS[m]}
              </label>
            ),
          )}
        </div>
      </fieldset>
      <button className="btn" disabled={pending}>Save</button>
    </form>
  );
}

export function StatusForm({ slug, status }: { slug: string; status: 'active' | 'suspended' }) {
  const { state, formAction, pending, attempt } = useRemountingAction(setCompanyStatus);
  const suspending = status === 'active';
  return (
    <section className="card">
      <h2 className="mb-3 text-lg font-semibold">Status</h2>
      <p className="mb-3 text-sm">
        Currently {suspending ? <span className="badge badge-ok">Active</span> : <span className="badge badge-bad">Suspended</span>}
      </p>
      <form key={attempt} action={formAction} className="space-y-3">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="status" value={suspending ? 'suspended' : 'active'} />
        <div>
          <label className="label" htmlFor="status-reason">Reason</label>
          <textarea id="status-reason" name="reason" className="input" rows={2} required defaultValue={valueOf(state, 'reason', '')} />
        </div>
        <div>
          <label className="label" htmlFor="status-confirm">Type the slug to confirm</label>
          <input id="status-confirm" name="confirm" className="input" autoComplete="off" required defaultValue={valueOf(state, 'confirm', '')} />
        </div>
        <button className={suspending ? 'btn btn-danger' : 'btn'} disabled={pending}>
          {suspending ? 'Suspend company' : 'Reactivate company'}
        </button>
      </form>
      <Messages state={state} />
    </section>
  );
}

export function FirstAdminForm({ slug, byEmail }: { slug: string; byEmail: boolean }) {
  const { state, formAction, pending, attempt } = useRemountingAction(firstAdmin);
  return (
    <section className="card">
      <h2 className="mb-3 text-lg font-semibold">First admin</h2>
      <p className="mb-3 text-sm text-muted">
        {byEmail ? (
          <>A new address gets an invite email; a login this company already has gets a password-reset email (or the
            invite again if never accepted). If another company also uses it, it becomes an admin here, keeps its own
            password and gets a notice.</>
        ) : (
          <>If a login with this email already exists in the company, it becomes an active admin and gets a new temporary
            password. If another company also uses it, it becomes an admin here and keeps its own password.</>
        )}
      </p>
      <form key={attempt} action={formAction} className="space-y-3">
        <input type="hidden" name="slug" value={slug} />
        <div>
          <label className="label" htmlFor="admin-email">Email</label>
          <input id="admin-email" name="email" type="email" className="input" required defaultValue={valueOf(state, 'email', '')} />
        </div>
        <div>
          <label className="label" htmlFor="admin-name">Full name</label>
          <input id="admin-name" name="fullName" className="input" required defaultValue={valueOf(state, 'fullName', '')} />
        </div>
        <button className="btn" disabled={pending}>{byEmail ? 'Send invite' : 'Create admin login'}</button>
      </form>
      <Messages state={state} />
      {state.password && (
        <div className="mt-3 space-y-2">
          <p className="text-sm">Login: <strong>{state.email}</strong></p>
          <TemporaryPassword password={state.password} />
          <p className="text-sm text-muted">Shown once. Hand it over in person; they change it under Account security.</p>
        </div>
      )}
    </section>
  );
}

/** Retries adding one address to the Vercel project (Address panel). */
export function AddDomainButton({ slug, host }: { slug: string; host: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(addDomain, {});
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="host" value={host} />
      <button className="btn-secondary btn" disabled={pending} aria-label={`Add ${host} to Vercel`}>Add to Vercel</button>
      <Messages state={state} />
    </form>
  );
}
