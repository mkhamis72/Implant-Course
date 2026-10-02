'use client';

import { useMemo, useState, useTransition } from 'react';
import { Odontogram } from '@/components/odontogram/odontogram';
import { Legend } from '@/components/odontogram/legend';
import { MANUAL_STATES, STATE_LABELS, canSetByHand, type ManualState, type ToothState } from '@/lib/patients/types';
import { badgesFor } from '@/lib/inventory/components';
import type { ChartData } from '@/lib/inventory/types';
import { setToothStatus } from './chart-actions';
import { ImplantSection } from './implant-section';

type Props = {
  patientId: string;
  data: ChartData;
  initialTooth: number | null;
};

export function ChartPanel({ patientId, data, initialTooth }: Props) {
  const statuses = data.statuses;
  const badges = useMemo(() => badgesFor(data.sites), [data.sites]);
  const [selected, setSelected] = useState<number[]>(initialTooth ? [initialTooth] : []);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSelect(fdi: number, additive: boolean) {
    setError(null);
    setSelected((current) => {
      if (additive) {
        return current.includes(fdi) ? current.filter((t) => t !== fdi) : [...current, fdi].sort((a, b) => a - b);
      }
      return current.length === 1 && current[0] === fdi ? [] : [fdi];
    });
  }

  function apply(status: ManualState) {
    startTransition(async () => {
      const result = await setToothStatus({ patientId, teeth: selected, status });
      setError(result.error ?? null);
    });
  }

  const statusOf = (t: number): ToothState => statuses[t] ?? 'present';
  const locked = selected.filter((t) => !canSetByHand(statusOf(t)));

  return (
    <div className="flex flex-col gap-4 xl:flex-row">
      <div className="card flex-1 space-y-4">
        <Odontogram statuses={statuses} badges={badges} selected={selected} onSelect={onSelect} />
        <Legend />
      </div>
      <aside className="card w-full space-y-4 xl:w-80" aria-label="Tooth details">
        {selected.length === 0 ? (
          <p className="text-sm text-gray-600">
            Click a tooth to see and change its status. Shift- or Ctrl-click to select several teeth.
          </p>
        ) : (
          <>
            <h2 className="font-semibold">
              {selected.length === 1 ? `Tooth ${selected[0]}` : `${selected.length} teeth: ${selected.join(', ')}`}
            </h2>
            <ul className="space-y-1 text-sm">
              {selected.map((t) => (
                <li key={t}>
                  Tooth {t}: {STATE_LABELS[statusOf(t)]}
                </li>
              ))}
            </ul>
            {locked.length > 0 ? (
              <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">
                Teeth with implant records ({locked.join(', ')}) are changed from the implant workflow, not here.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {MANUAL_STATES.map((state) => (
                  <button key={state} className="btn-secondary btn" disabled={pending} onClick={() => apply(state)}>
                    Mark {STATE_LABELS[state].toLowerCase()}
                  </button>
                ))}
              </div>
            )}
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            {selected.length === 1 && (
              <ImplantSection key={selected[0]} patientId={patientId} tooth={selected[0]} status={statusOf(selected[0])} data={data} />
            )}
          </>
        )}
      </aside>
    </div>
  );
}
