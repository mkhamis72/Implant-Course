'use client';

import { useActionState, useId, useRef } from 'react';
import { valueOf, type FormState } from '@/lib/patients/form-state';
import { CLINIC_CONSENT_TEMPLATE, CLINIC_TEMPLATE_REVIEW } from '@/lib/consent/clinic-template';
import { saveConsentVersion } from './actions';

export type ConsentVersion = {
  id: string; label: string; effective_on: string; text_en: string; text_ar: string; in_use: boolean;
};

const LOCKED = "This form version has been signed by patients and can't be changed. Add a new version instead.";

/**
 * Edits one form version, or adds a new one (no `version`; `start` prefills the texts, and a template also the label;
 * an add from the template returns to the plain page once saved).
 * While the label is the clinic template's draft label the review banner shows. A version patients have
 * signed is shown read-only with the database's lock message.
 */
export function VersionForm({ version, start }: {
  version?: ConsentVersion; start?: { label?: string; text_en: string; text_ar: string };
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveConsentVersion, {});
  const id = useId();
  // A successful add remounts the form (new key) so it starts clean and a second submit can't re-add.
  const added = useRef({ state, count: 0 });
  if (added.current.state !== state) {
    added.current = { state, count: added.current.count + (state.ok && !version ? 1 : 0) };
  }
  const locked = Boolean(version?.in_use);
  // A failed save keeps what was typed; otherwise the saved version (or, when adding, the starting text).
  const value = (key: 'label' | 'effective_on' | 'text_en' | 'text_ar', fallback: string | undefined) =>
    valueOf(state, key, version?.[key] ?? fallback);
  const label = value('label', start?.label ?? '');

  return (
    <form key={added.current.count} action={action} className="space-y-3">
      {version && <input type="hidden" name="id" value={version.id} />}
      {!version && start?.label && <input type="hidden" name="from_template" value="clinic" />}
      {locked && <p className="rounded-md border border-warn-line bg-warn-soft px-3 py-2 text-sm text-warn">{LOCKED}</p>}
      {label === CLINIC_CONSENT_TEMPLATE.label && (
        <p className="rounded-md border border-warn-line bg-warn-soft px-3 py-2 text-sm text-warn">{CLINIC_TEMPLATE_REVIEW}</p>
      )}
      <div className="flex flex-wrap gap-3">
        <div>
          <label className="label" htmlFor={`${id}-label`}>Label</label>
          <input id={`${id}-label`} className="input" name="label" maxLength={20} required disabled={locked}
            defaultValue={label} placeholder="v2" />
        </div>
        <div>
          <label className="label" htmlFor={`${id}-effective`}>Effective from</label>
          <input id={`${id}-effective`} className="input" type="date" name="effective_on" required disabled={locked}
            defaultValue={value('effective_on', '')} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor={`${id}-en`}>English text</label>
        <textarea id={`${id}-en`} className="input font-mono text-sm" name="text_en" rows={14} required disabled={locked}
          defaultValue={value('text_en', start?.text_en)} />
      </div>
      <div>
        <label className="label" htmlFor={`${id}-ar`}>Arabic text</label>
        <textarea id={`${id}-ar`} className="input font-mono text-sm" name="text_ar" rows={14} dir="rtl" lang="ar" required disabled={locked}
          defaultValue={value('text_ar', start?.text_ar)} />
      </div>
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm text-ok">{state.ok}</p>}
      {!locked && (
        <button className="btn" disabled={pending}>{version ? 'Save changes' : 'Add version'}</button>
      )}
    </form>
  );
}
