'use client';

import { useState, useTransition } from 'react';
import { todayIso } from '@/lib/dates';
import { MAX_CONSENT_BYTES } from '@/lib/consent/files';
import { prepareScan } from '@/lib/consent/prepare-scan';
import type { StudyRow } from '@/lib/research/studies';
import { saveStudy } from './actions';

type CourseOption = { id: string; name: string };

function TextField({ name, label, defaultValue, maxLength, required = false }: {
  name: string; label: string; defaultValue: string | null | undefined; maxLength: number; required?: boolean;
}) {
  return (
    <label className="block">
      <span className="label">
        {label}
        {required && <span aria-hidden="true" className="text-bad"> *</span>}
      </span>
      <input name={name} className="input" maxLength={maxLength} defaultValue={defaultValue ?? ''} aria-required={required || undefined} />
    </label>
  );
}

function DateField({ name, label, defaultValue, max }: { name: string; label: string; defaultValue: string | null | undefined; max?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input name={name} type="date" className="input" max={max} defaultValue={defaultValue ?? ''} />
    </label>
  );
}

/** Adds or edits a study: title, ethics approval, protocol, notes, courses covered and the approval letter. */
export function StudyForm({ study, courses, onDone }: { study?: StudyRow; courses: CourseOption[]; onDone?: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Remounted after a save so a new study's fields and the file input clear; a refusal keeps what was typed.
  const [formKey, setFormKey] = useState(0);
  const chosen = new Set((study?.courses ?? []).map((c) => c.id));
  // A course the study names but the picker doesn't list (none should be missing) still shows, so saving keeps it.
  const options = [...courses, ...(study?.courses ?? []).filter((c) => !courses.some((o) => o.id === c.id))];

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setError(null);
    if (!String(fd.get('title') ?? '').trim()) {
      setError('Enter the study title.');
      return;
    }
    const file = (form.elements.namedItem('letter') as HTMLInputElement).files?.[0];
    start(async () => {
      if (file && file.size > 0) {
        let letter: File;
        try {
          letter = await prepareScan(file, 'approval-letter');
        } catch {
          setError("This photo couldn't be processed in this browser. Try another browser, or upload a PDF.");
          return;
        }
        if (letter.size > MAX_CONSENT_BYTES) {
          setError('The file is larger than 2 MB.');
          return;
        }
        fd.set('letter', letter);
      } else {
        fd.delete('letter');
      }
      const result = await saveStudy(study?.id ?? null, fd);
      if (result.error) {
        setError(result.error);
      } else {
        setFormKey((k) => k + 1);
        onDone?.();
      }
    });
  }

  return (
    <form key={formKey} className="space-y-3" onSubmit={onSubmit} aria-label={study ? `Edit ${study.title}` : 'Add study'}>
      <TextField name="title" label="Title" defaultValue={study?.title} maxLength={200} required />
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField name="committee" label="Ethics committee" defaultValue={study?.committee} maxLength={200} />
        <TextField name="approval_number" label="Approval number" defaultValue={study?.approval_number} maxLength={100} />
        <DateField name="approval_date" label="Approval date" defaultValue={study?.approval_date} max={todayIso()} />
        <TextField name="protocol_name" label="Protocol name" defaultValue={study?.protocol_name} maxLength={200} />
        <TextField name="protocol_version" label="Protocol version" defaultValue={study?.protocol_version} maxLength={50} />
        <DateField name="protocol_date" label="Protocol date" defaultValue={study?.protocol_date} />
      </div>
      <fieldset className="space-y-1">
        <legend className="label">Courses covered</legend>
        {options.length === 0 ? <p className="text-sm text-muted">No courses yet.</p> : (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {options.map((c) => (
              <label key={c.id} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="courses" value={c.id} defaultChecked={chosen.has(c.id)} />
                {c.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <label className="block">
        <span className="label">Notes</span>
        <textarea name="notes" className="input" rows={2} maxLength={2000} defaultValue={study?.notes ?? ''} />
      </label>
      <p className="text-sm text-muted">Notes stay in the app: they are never exported.</p>
      <label className="block">
        <span className="label">Approval letter (photo or PDF){study?.has_letter && ' — replaces the current one'}</span>
        <input name="letter" className="input" type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf" />
      </label>
      {study?.has_letter && (
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" name="remove_letter" />
          Remove the current letter
        </label>
      )}
      <p className="text-sm text-muted">Photos are reduced to 2000 px before upload. A PDF must be 2 MB or smaller.</p>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <button className="btn" disabled={pending}>{pending ? 'Saving…' : 'Save study'}</button>
    </form>
  );
}
