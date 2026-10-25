'use client';

import { useState } from 'react';
import type { AnalysisConfig } from '@/lib/analysis/run';
import { TIMEPOINTS, type Window } from '@/lib/analysis/timepoints';
import { factorChoices, outcomeChoices, variable, type Variable } from '@/lib/analysis/variables';

export const EXAMPLES: { factor: string; outcome: string }[] = [
  { factor: 'smoking', outcome: 'bone_change' },
  { factor: 'diameter', outcome: 'survival' },
  { factor: 'isq_placement', outcome: 'bone_change' },
  { factor: 'periodontitis', outcome: 'biological_complication' },
  { factor: 'course', outcome: 'final_restoration' },
];

function Grouped({ choices }: { choices: Variable[] }) {
  const groups = [...new Set(choices.map((v) => v.group))];
  return groups.map((g) => (
    <optgroup key={g} label={g}>
      {choices.filter((v) => v.group === g).map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
    </optgroup>
  ));
}

const windowValue = (w: Window | 'all') => (typeof w === 'string' ? w : 'custom');

export function QuestionCard({ config, onChange }: { config: AnalysisConfig; onChange: (next: Partial<AnalysisConfig>) => void }) {
  const outcome = config.outcome ? variable(config.outcome) : undefined;
  const timed = outcome !== undefined && outcome.source !== 'implant';
  const custom = typeof config.window === 'string' ? null : config.window;
  const [from, setFrom] = useState(custom ? String(custom.from) : '');
  const [to, setTo] = useState(custom ? String(custom.to) : '');
  const [showCustom, setShowCustom] = useState(custom !== null);

  const applyCustom = (f: string, t: string) => {
    const a = Number(f);
    const b = Number(t);
    if (f !== '' && t !== '' && Number.isInteger(a) && Number.isInteger(b) && a >= 0 && a <= b) onChange({ window: { from: a, to: b } });
  };

  return (
    <section aria-labelledby="explore-question" className="card space-y-4">
      <h2 id="explore-question" className="text-lg font-semibold">What would you like to understand?</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block">
          <span className="label">Compare by</span>
          <select className="input" value={config.factor ?? ''} onChange={(e) => onChange({ factor: e.target.value || null })}>
            <option value="">Nothing — describe the outcome</option>
            <Grouped choices={factorChoices()} />
          </select>
        </label>
        <label className="block">
          <span className="label">Outcome</span>
          <select className="input" value={config.outcome} onChange={(e) => onChange({ outcome: e.target.value })}>
            <option value="">Choose an outcome</option>
            <Grouped choices={outcomeChoices()} />
          </select>
        </label>
        {timed && (
          <div className="space-y-2">
            <label className="block">
              <span className="label">Timepoint</span>
              <select className="input" value={showCustom ? 'custom' : windowValue(config.window)}
                onChange={(e) => {
                  const v = e.target.value;
                  setShowCustom(v === 'custom');
                  if (v !== 'custom') onChange({ window: v as Window | 'all' });
                }}>
                {TIMEPOINTS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                <option value="all">All timepoints (trend)</option>
                <option value="custom">Custom days…</option>
              </select>
            </label>
            {showCustom && (
              <div className="flex gap-2">
                <label className="block flex-1">
                  <span className="label">From day</span>
                  <input className="input" inputMode="numeric" value={from} onChange={(e) => { setFrom(e.target.value); applyCustom(e.target.value, to); }} />
                </label>
                <label className="block flex-1">
                  <span className="label">To day</span>
                  <input className="input" inputMode="numeric" value={to} onChange={(e) => { setTo(e.target.value); applyCustom(from, e.target.value); }} />
                </label>
              </div>
            )}
          </div>
        )}
      </div>
      {!config.outcome && (
        <div className="space-y-2">
          <p className="text-sm text-muted">Or start from an example:</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button key={`${ex.factor}-${ex.outcome}`} type="button" className="btn-secondary text-sm"
                onClick={() => onChange({ factor: ex.factor, outcome: ex.outcome })}>
                {variable(ex.factor)!.label} → {variable(ex.outcome)!.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
