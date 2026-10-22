'use client';

import { useState } from 'react';
import { formatDate } from '@/lib/format';
import {
  RADIOGRAPH_PURPOSE_LABELS, RADIOGRAPH_TYPE_LABELS, boneLevelLabel, type Radiograph,
} from '@/lib/radiographs/radiographs';
import { RadiographForm, type XraySite } from './radiograph-form';
import { voidRadiograph } from './actions';

/** The X-rays, newest first, with Add / Edit / Remove for editors. */
export function XrayList({ patientId, radiographs, sites, editable }: {
  patientId: string; radiographs: Radiograph[]; sites: XraySite[]; editable: boolean;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-3">
      {editable && !adding && <button type="button" className="btn" onClick={() => setAdding(true)}>Add X-ray</button>}
      {adding && <RadiographForm patientId={patientId} sites={sites} onDone={() => setAdding(false)} />}
      {radiographs.length === 0 && !adding && <p className="text-sm text-muted">No X-rays recorded.</p>}
      <ul className="space-y-3">
        {radiographs.map((r) => (
          <li key={r.id}><XrayCard r={r} patientId={patientId} sites={sites} editable={editable} /></li>
        ))}
      </ul>
    </div>
  );
}

function XrayCard({ r, patientId, sites, editable }: { r: Radiograph; patientId: string; sites: XraySite[]; editable: boolean }) {
  const [mode, setMode] = useState<'view' | 'edit' | 'remove'>('view');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function remove() {
    setPending(true);
    setError(null);
    const result = await voidRadiograph({ patientId, id: r.id, reason });
    setPending(false);
    if (result.error) setError(result.error);
  }

  if (mode === 'edit') {
    return <RadiographForm patientId={patientId} sites={sites} radiograph={r} onDone={() => setMode('view')} />;
  }
  return (
    <div data-testid="xray" className="card space-y-2 py-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-medium">{formatDate(r.taken_on)}</span>
        <span>{RADIOGRAPH_TYPE_LABELS[r.type]}</span>
        <span className="badge">{RADIOGRAPH_PURPOSE_LABELS[r.purpose]}</span>
        <span className="text-muted">Teeth {r.teeth.join(', ')}</span>
        {r.link && <a href={r.link} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Open image ↗</a>}
      </div>
      {r.notes && <p className="whitespace-pre-wrap text-sm">{r.notes}</p>}
      {r.levels.length > 0 && (
        <table className="table">
          <thead><tr><th>Tooth</th><th>Mesial</th><th>Distal</th></tr></thead>
          <tbody>
            {r.levels.map((l) => (
              <tr key={l.site}>
                <td data-label="Tooth">{l.tooth}</td>
                <td data-label="Mesial">{boneLevelLabel(l.mesial_mm)}</td>
                <td data-label="Distal">{boneLevelLabel(l.distal_mm)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editable && mode === 'view' && (
        <div className="flex gap-2">
          <button type="button" className="btn-secondary btn" onClick={() => setMode('edit')}>Edit</button>
          <button type="button" className="btn-secondary btn" onClick={() => setMode('remove')}>Remove</button>
        </div>
      )}
      {mode === 'remove' && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="label">Reason for removing</span>
            <input className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button type="button" className="btn-danger btn" disabled={pending} onClick={remove}>Remove from record</button>
          <button type="button" className="btn-secondary btn" onClick={() => setMode('view')}>Keep</button>
        </div>
      )}
      {error && <p role="alert" className="text-bad">{error}</p>}
    </div>
  );
}
