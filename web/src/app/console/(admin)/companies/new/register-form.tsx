'use client';

import Link from 'next/link';
import { useActionState, useRef } from 'react';
import { valueOf } from '@/lib/patients/form-state';
import { suggestSlug } from '@/lib/console/onboarding';
import { TemporaryPassword } from '@/components/temporary-password';
import { onboardCompany, type OnboardState } from '../../actions';

/** One form adds a company: name → slug → address are suggested in turn until edited by hand. */
export function RegisterForm({ baseDomain }: { baseDomain: string | null }) {
  const [state, action, pending] = useActionState<OnboardState, FormData>(onboardCompany, {});
  const slugRef = useRef<HTMLInputElement>(null);
  const hostsRef = useRef<HTMLTextAreaElement>(null);
  const edited = useRef({ slug: false, hosts: false });

  const suggestHost = (slug: string) => {
    if (!edited.current.hosts && hostsRef.current && baseDomain) hostsRef.current.value = slug ? `${slug}.${baseDomain}` : '';
  };

  if (state.steps && state.slug) {
    return (
      <section className="card space-y-3" aria-live="polite">
        <h2 className="text-lg font-semibold">{state.ok}</h2>
        <ul className="space-y-2">
          {state.steps.map((s) => (
            <li key={s.label} className={s.ok ? 'rule-ok' : 'rule-warn'}>
              <span className="font-medium">{s.label}:</span> {s.detail}
            </li>
          ))}
        </ul>
        {state.password && state.email && (
          <div>
            <p className="text-sm text-muted">Temporary password for {state.email} (shown once):</p>
            <TemporaryPassword password={state.password} />
          </div>
        )}
        <Link href={`/console/companies/${state.slug}`} className="btn">Open the company</Link>
      </section>
    );
  }

  return (
    <form action={action} className="card space-y-3">
      <div>
        <label className="label" htmlFor="name">Company name</label>
        <input
          id="name" name="name" className="input" required defaultValue={valueOf(state, 'name', '')}
          onChange={(e) => {
            if (edited.current.slug || !slugRef.current) return;
            slugRef.current.value = suggestSlug(e.target.value);
            suggestHost(slugRef.current.value);
          }}
        />
      </div>
      <div>
        <label className="label" htmlFor="slug">Slug</label>
        <input
          id="slug" name="slug" ref={slugRef} className="input" required defaultValue={valueOf(state, 'slug', '')}
          aria-describedby="slug-hint"
          onChange={(e) => { edited.current.slug = true; suggestHost(e.target.value); }}
        />
        <p id="slug-hint" className="mt-1 text-xs text-muted">Lower-case letters, digits and hyphens. It can’t be changed later.</p>
      </div>
      <div>
        <label className="label" htmlFor="hosts">Address (one per line)</label>
        <textarea
          id="hosts" name="hosts" ref={hostsRef} className="input" rows={2} required defaultValue={valueOf(state, 'hosts', '')}
          onChange={() => { edited.current.hosts = true; }}
        />
      </div>
      <fieldset className="space-y-3 border-t border-line pt-3">
        <legend className="text-sm font-semibold">First admin</legend>
        <div>
          <label className="label" htmlFor="fullName">Full name</label>
          <input id="fullName" name="fullName" className="input" required defaultValue={valueOf(state, 'fullName', '')} />
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" className="input" required defaultValue={valueOf(state, 'email', '')} />
        </div>
      </fieldset>
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      <button className="btn" disabled={pending}>{pending ? 'Adding…' : 'Add company'}</button>
    </form>
  );
}
