'use client';

import { useState, useTransition } from 'react';
import { todayIso } from '@/lib/dates';
import { formatDate } from '@/lib/format';
import { JPEG_QUALITY, MAX_CONSENT_BYTES, fitWithin } from '@/lib/consent/files';
import { CONSENT_ITEMS, CONSENT_LANGUAGES, CONSENT_LANGUAGE_LABELS, type ConsentVersionOption } from '@/lib/consent/labels';
import { Field } from '../implant-forms';
import { recordConsent } from './actions';

const RESIZABLE = ['image/jpeg', 'image/png', 'image/webp'];

/** A photo becomes a JPEG at most 2000 px on its longest side; PDFs (and anything the server will refuse) pass through. */
async function prepareScan(file: File): Promise<File> {
  if (!RESIZABLE.includes(file.type)) return file;
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const { w, h } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas');
  // A transparent PNG would turn black as JPEG: paper is white.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) throw new Error('Could not encode');
  return new File([blob], `${file.name.replace(/\.[^.]*$/, '') || 'consent'}.jpg`, { type: 'image/jpeg' });
}

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
        scan = await prepareScan(file);
      } catch {
        setError('Upload a JPEG photo or a PDF.');
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
