'use client';

import { useState } from 'react';
import { levelChoices, type LevelLabels } from '@/lib/analysis/choices';
import { describeFilters, type Filter } from '@/lib/analysis/filters';
import type { ImplantRow } from '@/lib/analysis/rows';
import { factorChoices, variable } from '@/lib/analysis/variables';

const isRange = (key: string) => ['continuous', 'count'].includes(variable(key)?.kind ?? '');

export function FilterChips({ filters, rows, labels, onChange }: {
  filters: Filter[];
  rows: ImplantRow[];
  labels: LevelLabels;
  onChange: (filters: Filter[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [values, setValues] = useState<string[]>([]);
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const descriptions = describeFilters(filters);
  const choices = factorChoices().filter((v) => !filters.some((f) => f.key === v.key));

  const reset = () => { setOpen(false); setKey(''); setValues([]); setMin(''); setMax(''); };
  const number = (s: string) => (s.trim() === '' || !Number.isFinite(Number(s)) ? undefined : Number(s));
  const draft: Filter | null = !key ? null
    : isRange(key)
      ? (number(min) === undefined && number(max) === undefined ? null
        : { key, ...(number(min) !== undefined ? { min: number(min) } : {}), ...(number(max) !== undefined ? { max: number(max) } : {}) })
      : (values.length ? { key, values } : null);

  return (
    <section aria-label="Filters on the analysis" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {filters.map((f, i) => (
          <span key={f.key} className="badge inline-flex items-center gap-1">
            {descriptions[i]}
            <button type="button" aria-label={`Remove filter ${descriptions[i]}`} className="text-muted hover:text-ink"
              onClick={() => onChange(filters.filter((x) => x.key !== f.key))}>×</button>
          </span>
        ))}
        {!open && <button type="button" className="btn-secondary text-sm" onClick={() => setOpen(true)}>Add filter</button>}
      </div>
      {open && (
        <div className="card space-y-3">
          <label className="block max-w-sm">
            <span className="label">Filter by</span>
            <select className="input" value={key} onChange={(e) => { setKey(e.target.value); setValues([]); setMin(''); setMax(''); }}>
              <option value="">Choose a variable</option>
              {choices.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
            </select>
          </label>
          {key && isRange(key) && (
            <div className="flex max-w-sm gap-2">
              <label className="block flex-1"><span className="label">Min</span>
                <input className="input" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} /></label>
              <label className="block flex-1"><span className="label">Max</span>
                <input className="input" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} /></label>
            </div>
          )}
          {key && !isRange(key) && (
            <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
              <legend className="sr-only">Values</legend>
              {levelChoices(rows, key, labels).map((l) => (
                <label key={l.value} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" checked={values.includes(l.value)}
                    onChange={(e) => setValues(e.target.checked ? [...values, l.value] : values.filter((v) => v !== l.value))} />
                  {l.label}
                </label>
              ))}
            </fieldset>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn text-sm" disabled={!draft} onClick={() => { if (draft) { onChange([...filters, draft]); reset(); } }}>
              Apply filter
            </button>
            <button type="button" className="btn-secondary text-sm" onClick={reset}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
