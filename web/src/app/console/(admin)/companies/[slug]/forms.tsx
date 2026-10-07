'use client';

import { useActionState, useState } from 'react';
import { valueOf, type FormState } from '@/lib/patients/form-state';
import { TemporaryPassword } from '@/components/temporary-password';
import { firstAdmin, replaceCompanyKeys, setCompanyStatus, updateCompany, type FirstAdminState } from '../../actions';

/** useActionState plus a counter that changes on every result, so the form remounts (React 19 resets uncontrolled inputs). */
function useRemountingAction(action: (prev: FirstAdminState, formData: FormData) => Promise<FirstAdminState>) {
  const [attempt, setAttempt] = useState(0);
  const [state, formAction, pending] = useActionState(async (prev: FirstAdminState, formData: FormData) => {
    const next = await action(prev, formData);
    setAttempt((n) => n + 1);
    return next;
  }, {} as FirstAdminState);
  return { state, formAction, pending, attempt };
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

export function ReplaceKeysForm({ slug }: { slug: string }) {
  const { state, formAction, pending, attempt } = useRemountingAction(replaceCompanyKeys);
  return (
    <section className="card">
      <h2 className="mb-3 text-lg font-semibold">Replace keys</h2>
      <p className="mb-3 text-sm text-muted">Keys are checked before they are saved, and never shown again.</p>
      <form key={attempt} action={formAction} className="space-y-3">
        <input type="hidden" name="slug" value={slug} />
        <div>
          <label className="label" htmlFor="keys-url">Supabase URL</label>
          <input id="keys-url" name="supabaseUrl" className="input" required defaultValue={valueOf(state, 'supabaseUrl', '')} />
        </div>
        <div>
          <label className="label" htmlFor="keys-anon">Anon key</label>
          <input id="keys-anon" name="anonKey" type="password" autoComplete="off" className="input" required />
        </div>
        <div>
          <label className="label" htmlFor="keys-service">Service role key</label>
          <input id="keys-service" name="serviceRoleKey" type="password" autoComplete="off" className="input" required />
        </div>
        <div>
          <label className="label" htmlFor="keys-db">Database URL (session pooler)</label>
          <input id="keys-db" name="databaseUrl" type="password" autoComplete="off" className="input" required />
        </div>
        <button className="btn" disabled={pending}>Check and replace keys</button>
      </form>
      <Messages state={state} />
    </section>
  );
}

export function FirstAdminForm({ slug }: { slug: string }) {
  const { state, formAction, pending, attempt } = useRemountingAction(firstAdmin);
  return (
    <section className="card">
      <h2 className="mb-3 text-lg font-semibold">First admin</h2>
      <p className="mb-3 text-sm text-muted">
        If a login with this email already exists in the company, it becomes an active admin and gets a new temporary password.
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
        <button className="btn" disabled={pending}>Create admin login</button>
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
