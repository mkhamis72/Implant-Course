'use client';

import { useActionState } from 'react';
import { valueOf, type FormState } from '@/lib/patients/form-state';
import { registerCompany } from '../../actions';

export function RegisterForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(registerCompany, {});
  return (
    <form action={action} className="card space-y-3">
      <div>
        <label className="label" htmlFor="slug">Slug</label>
        <input id="slug" name="slug" className="input" required defaultValue={valueOf(state, 'slug', '')} />
      </div>
      <div>
        <label className="label" htmlFor="name">Name</label>
        <input id="name" name="name" className="input" required defaultValue={valueOf(state, 'name', '')} />
      </div>
      <div>
        <label className="label" htmlFor="hosts">Addresses (one per line)</label>
        <textarea id="hosts" name="hosts" className="input" rows={3} required defaultValue={valueOf(state, 'hosts', '')} />
      </div>
      <div>
        <label className="label" htmlFor="supabaseUrl">Supabase URL</label>
        <input id="supabaseUrl" name="supabaseUrl" className="input" required defaultValue={valueOf(state, 'supabaseUrl', '')} />
      </div>
      <div>
        <label className="label" htmlFor="anonKey">Anon key</label>
        <input id="anonKey" name="anonKey" type="password" autoComplete="off" className="input" required />
      </div>
      <div>
        <label className="label" htmlFor="serviceRoleKey">Service role key</label>
        <input id="serviceRoleKey" name="serviceRoleKey" type="password" autoComplete="off" className="input" required />
      </div>
      <div>
        <label className="label" htmlFor="databaseUrl">Database URL (session pooler)</label>
        <input id="databaseUrl" name="databaseUrl" type="password" autoComplete="off" className="input" required />
      </div>
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      <button className="btn" disabled={pending}>{pending ? 'Checking…' : 'Check and add'}</button>
    </form>
  );
}
