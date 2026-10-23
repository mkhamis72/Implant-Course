'use client';

import { useState, useTransition } from 'react';
import { todayIso } from '@/lib/dates';
import { formatDate } from '@/lib/format';
import { MAX_CONSENT_BYTES } from '@/lib/consent/files';
import { prepareScan } from '@/lib/consent/prepare-scan';
import { CONSENT_ITEMS, CONSENT_LANGUAGES, CONSENT_LANGUAGE_LABELS, type ConsentVersionOption } from '@/lib/consent/labels';
import { Field } from '../implant-forms';
import { recordConsent } from './actions';

/** Records a signed consent form: version, language, date, the four answers (no default) and the scan. */
export function ConsentForm({ patientId, versions, currentVersionId }: {
  patientId: string; versions: ConsentVersionOption[]; currentVersionId: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  // Remounted after each save so the answers and file clear; on a refusal nothing resets (no form action).
  const [formKey, setFormKey] = useState(0);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    setSaved(false);
    if (CONSENT_ITEMS.some((item) => !fd.get(item.key))) {
      setError('Answer all four items (yes or no).');
      return;
    }
    const file = (e.currentTarget.elements.namedItem('file') as HTMLInputElement).files?.[0];
    if (!file || file.size === 0) {
      setError('Upload the signed form.');
      return;
    }
    start(async () => {
      let scan: File;
      try {
        scan = await prepareScan(file, 'consent');
      } catch {
        setError("This photo couldn't be processed in this browser. Try another browser, or upload a PDF.");
        return;
      }
      if (scan.size > MAX_CONSENT_BYTES) {
        setError('The file is larger than 2 MB.');
        return;
      }
      fd.set('file', scan);
      const result = await recordConsent(patientId, fd);
      if (result.error) {
        setError(result.error);
      } else {
        setSaved(true);
        setFormKey((k) => k + 1);
      }
    });
  }

  if (versions.length === 0) {
    return <p className="text-sm text-muted">No consent form version is in effect yet. An admin adds one in Admin → Settings.</p>;
  }

  return (
    <form key={formKey} className="card space-y-3" onSubmit={onSubmit}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Form version" required>
          <select name="version" className="input" required aria-required="true" defaultValue={currentVersionId ?? versions[0].id}>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>{`${v.label} (from ${formatDate(v.effective_on)})`}</option>
            ))}
          </select>
        </Field>
        <Field label="Language" required>
          <select name="language" className="input" required aria-required="true" defaultValue="">
            <option value="">Choose…</option>
            {CONSENT_LANGUAGES.map((l) => <option key={l} value={l}>{CONSENT_LANGUAGE_LABELS[l]}</option>)}
          </select>
        </Field>
        <Field label="Date signed" required>
          <input name="signed_on" className="input" type="date" required aria-required="true" max={todayIso()} defaultValue={todayIso()} />
        </Field>
      </div>

      {CONSENT_ITEMS.map((item) => (
        <fieldset key={item.key} data-testid={`consent-item-${item.key}`} className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <legend className="label">
            {item.label}
            <span aria-hidden="true" className="text-bad"> *</span>
          </legend>
          {(['yes', 'no'] as const).map((value) => (
            <label key={value} className="flex items-center gap-1.5 text-sm">
              <input type="radio" name={item.key} value={value} required />
              {value === 'yes' ? 'Yes' : 'No'}
            </label>
          ))}
        </fieldset>
      ))}

      <Field label="Signed form (photo or PDF)" required>
        <input
          name="file"
          className="input"
          type="file"
          required
          aria-required="true"
          accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"
        />
      </Field>
      <p className="text-sm text-muted">Photos are reduced to 2000 px before upload. A PDF must be 2 MB or smaller.</p>

      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      {saved && <p role="status" className="text-sm text-ok">Consent recorded.</p>}
      <button className="btn" disabled={pending}>{pending ? 'Recording…' : 'Record consent'}</button>
    </form>
  );
}
