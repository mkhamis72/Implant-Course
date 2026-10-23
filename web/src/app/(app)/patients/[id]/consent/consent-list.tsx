'use client';

import { useState } from 'react';
import { formatDate, formatDateTime } from '@/lib/format';
import { CONSENT_ITEMS, CONSENT_LANGUAGE_LABELS, type ConsentRecord } from '@/lib/consent/labels';
import { voidConsent } from './actions';

const fileHref = (patientId: string, r: ConsentRecord) => `/patients/${patientId}/consent/file/${r.file_id}`;

function Answer({ yes }: { yes: boolean }) {
  return <span className={yes ? 'badge-ok' : 'badge-warn'}>{yes ? 'Yes' : 'No'}</span>;
}

function SignedFormLink({ patientId, r }: { patientId: string; r: ConsentRecord }) {
  return (
    <a href={fileHref(patientId, r)} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
      View signed form ↗
    </a>
  );
}

/** Void with a reason (wrong patient, unreadable scan); the record stays in the history, struck through. */
function VoidConsent({ patientId, id }: { patientId: string; id: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setError(null);
    const result = await voidConsent(patientId, id, reason);
    setPending(false);
    if (result.error) setError(result.error);
    else setOpen(false);
  }

  if (!open) return <button type="button" className="btn-secondary btn" onClick={() => setOpen(true)}>Void</button>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="label">Reason for voiding</span>
          <input className="input" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button type="button" className="btn-danger btn" disabled={pending} onClick={submit}>Void record</button>
        <button type="button" className="btn-secondary btn" onClick={() => setOpen(false)}>Keep</button>
      </div>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
    </div>
  );
}

/** The current consent record, then every earlier one (voided ones struck through). */
export function ConsentList({ patientId, records, editable }: { patientId: string; records: ConsentRecord[]; editable: boolean }) {
  const current = records.find((r) => r.is_current) ?? null;
  const earlier = records.filter((r) => !r.is_current);

  return (
    <div className="space-y-4">
      {current ? (
        <div data-testid="current-consent" className="card space-y-3 py-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-medium">Signed {formatDate(current.signed_on)}</span>
            <span>Form {current.version_label}</span>
            <span>{CONSENT_LANGUAGE_LABELS[current.language]}</span>
            <SignedFormLink patientId={patientId} r={current} />
          </div>
          <ul className="space-y-1.5">
            {CONSENT_ITEMS.map((item) => (
              <li key={item.key} className="flex items-center justify-between gap-3 text-sm">
                <span>{item.label}</span>
                <Answer yes={current[item.key]} />
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">
            Recorded by {current.recorded_by_name ?? 'unknown'} on {formatDateTime(current.created_at)}
          </p>
          {editable && <VoidConsent patientId={patientId} id={current.id} />}
        </div>
      ) : (
        <p className="text-sm text-muted">No current consent record.</p>
      )}

      {earlier.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-semibold">Earlier records</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Signed</th><th>Form</th><th>Language</th><th>Answers</th><th>Recorded by</th><th>Scan</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {earlier.map((r) => {
                const struck = r.voided_at ? 'text-muted line-through' : '';
                return (
                  <tr key={r.id} data-testid="consent-history-row">
                    <td data-label="Signed" className={struck}>{formatDate(r.signed_on)}</td>
                    <td data-label="Form" className={struck}>{r.version_label}</td>
                    <td data-label="Language" className={struck}>{CONSENT_LANGUAGE_LABELS[r.language]}</td>
                    <td data-label="Answers" className={struck}>
                      {CONSENT_ITEMS.map((item) => `${item.short} ${r[item.key] ? 'yes' : 'no'}`).join(', ')}
                    </td>
                    <td data-label="Recorded by" className={struck}>{r.recorded_by_name ?? '—'}</td>
                    <td data-label="Scan"><SignedFormLink patientId={patientId} r={r} /></td>
                    <td data-label="Status">
                      {r.voided_at ? (
                        <span className="text-sm">
                          Voided {formatDateTime(r.voided_at)}{r.voided_by_name ? ` by ${r.voided_by_name}` : ''}: {r.voided_reason}
                        </span>
                      ) : editable ? (
                        <VoidConsent patientId={patientId} id={r.id} />
                      ) : (
                        <span className="text-sm text-muted">Replaced</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
