'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { Odontogram } from '@/components/odontogram/odontogram';
import { Legend } from '@/components/odontogram/legend';
import { MANUAL_STATES, STATE_LABELS, canSetByHand, type ManualState, type ToothState } from '@/lib/patients/types';
import { badgesFor } from '@/lib/inventory/components';
import { openComplicationTeeth } from '@/lib/implants/complications';
import { restorationSpans } from '@/lib/restorations/restorations';
import type { ChartData } from '@/lib/inventory/types';
import { setToothStatus } from './chart-actions';
import { statusTone, toothName, type Tone } from '@/lib/patients/tooth-panel';

const TONE_BADGE: Record<Tone, string> = { ok: 'badge-ok', warn: 'badge-warn', bad: 'badge-bad', accent: 'badge-accent', off: '' };
import { ImplantSection } from './implant-section';

type Props = {
  patientId: string;
  data: ChartData;
  initialTooth: number | null;
};

export function ChartPanel({ patientId, data, initialTooth }: Props) {
  const statuses = data.statuses;
  const badges = useMemo(() => badgesFor(data.sites), [data.sites]);
  const alerts = useMemo(() => openComplicationTeeth(data.sites), [data.sites]);
  const spans = useMemo(() => restorationSpans(data.restorations, data.sites), [data.restorations, data.sites]);
  const [selected, setSelected] = useState<number[]>(initialTooth ? [initialTooth] : []);
  // A restoration bar or covered tooth opens the Restoration tab; `n` remounts the panel when the tooth was already open.
  const [opened, setOpened] = useState<{ tab: 'restoration'; n: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const panelRef = useRef<HTMLElement>(null);

  function onSelect(fdi: number, additive: boolean, tab?: 'restoration') {
    setError(null);
    setOpened(tab ? { tab, n: (opened?.n ?? 0) + 1 } : null);
    // The panel sits under the chart. When its heading would be off-screen (phones, short windows), bring it into
    // view after a tap; otherwise leave the chart where it is, so the next tooth stays in reach.
    if (!additive) {
      const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      requestAnimationFrame(() => {
        const panel = panelRef.current;
        if (panel && panel.getBoundingClientRect().top > window.innerHeight - 120) panel.scrollIntoView({ behavior, block: 'start' });
      });
    }
    setSelected((current) => {
      if (tab) return [fdi];
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
    <div className="space-y-4">
      <div className="card space-y-4">
        {/* Touch screens keep teeth at a fingertip size (about 44px each); the chart scrolls sideways inside its panel. */}
        <div className="-mx-2 overflow-x-auto px-2">
          <div className="min-w-[36rem] sm:min-w-0 pointer-coarse:min-w-[46rem]">
            {/* Standard dental-chart orientation: the patient's right is on the viewer's left. */}
            <div aria-hidden="true" className="mb-1 flex max-w-4xl justify-between text-xs font-medium text-muted">
              <span>Right</span>
              <span>Left</span>
            </div>
            <Odontogram statuses={statuses} badges={badges} alerts={alerts} spans={spans} selected={selected} onSelect={onSelect} />
          </div>
        </div>
        <Legend />
      </div>
      <aside
        ref={panelRef}
        className="card scroll-mt-20 space-y-4"
        aria-label="Tooth details"
      >
        {selected.length === 0 ? (
          <p className="text-sm text-muted">
            Click a tooth to see and change its status. Shift- or Ctrl-click to select several teeth.
          </p>
        ) : (
          <>
            {selected.length === 1 ? (
              // The tooth number is how everyone at the chair refers to it: it leads the panel.
              <header className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-4xl leading-none font-semibold tracking-tight text-ink">
                    <span className="sr-only">Tooth </span>
                    {selected[0]}
                  </h2>
                  <p className="mt-1 text-sm text-muted">{toothName(selected[0])}</p>
                </div>
                <span data-testid="tooth-status" className={`badge ${TONE_BADGE[statusTone(statusOf(selected[0]))]} mt-1`}>
                  {STATE_LABELS[statusOf(selected[0])]}
                </span>
              </header>
            ) : (
              <>
                <h2 className="font-semibold">{`${selected.length} teeth: ${selected.join(', ')}`}</h2>
                <ul className="space-y-1 text-sm">
                  {selected.map((t) => (
                    <li key={t}>
                      Tooth {t}: {STATE_LABELS[statusOf(t)]}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {!data.editable ? null : locked.length > 0 ? (
              // An explanation, not a warning: quiet for one implant tooth, amber when a multi-selection is blocked.
              <p className={selected.length === 1 ? 'text-sm text-muted' : 'rounded-md bg-warn-soft p-3 text-sm text-warn'}>
                Teeth with implant records ({locked.join(', ')}) are changed from the implant workflow, not here.
              </p>
            ) : (
              <div role="group" aria-label="Tooth status" className="inline-flex rounded-lg border border-line-strong p-0.5">
                {MANUAL_STATES.map((state) => {
                  const current = selected.every((t) => statusOf(t) === state);
                  return (
                    <button
                      key={state}
                      aria-label={`Mark ${STATE_LABELS[state].toLowerCase()}`}
                      aria-pressed={current}
                      disabled={pending}
                      onClick={() => apply(state)}
                      className={`min-h-9 rounded-md px-3 text-sm ${current ? 'bg-ink font-semibold text-white' : 'text-ink hover:bg-sunken'}`}
                    >
                      {STATE_LABELS[state]}
                    </button>
                  );
                })}
              </div>
            )}
            {error && <p role="alert" className="text-sm text-bad">{error}</p>}
            {selected.length === 1 && (
              <ImplantSection key={`${selected[0]}:${opened?.n ?? 0}`} patientId={patientId} tooth={selected[0]} status={statusOf(selected[0])} data={data}
                openTab={opened?.tab} />
            )}
          </>
        )}
      </aside>
    </div>
  );
}
