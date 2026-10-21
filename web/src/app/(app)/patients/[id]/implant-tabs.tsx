'use client';

import { useId, useRef } from 'react';
import type { ChartData, ImplantSite } from '@/lib/inventory/types';
import { surgeryCompleteness } from '@/lib/implants/surgery';
import { isOpen } from '@/lib/implants/complications';
import { implantTabs, tabAfterKey, type ImplantTabKey, type TabBadge } from '@/lib/patients/implant-tabs';
import { currentRestoration } from '@/lib/restorations/restorations';
import { Corrections } from './corrections';
import { Restorations } from './restorations';
import { SurgicalDetails } from './surgical-details';
import { Visits } from './visits';
import { Complications } from './complications';
import { ImplantFacts, correctable } from './site-details';

const BADGE_TONE: Record<TabBadge['tone'], string> = { ok: 'badge-ok', warn: 'badge-warn', bad: 'badge-bad', off: '' };

/**
 * The current implant of a tooth, split into tabs (WAI-ARIA tabs: arrow keys, Home and End move between them).
 * Every panel stays mounted, so an open form keeps what was typed when another tab is chosen. The selected tab is
 * held by the section, so its action buttons can show the tab they change (Record visit → Visits).
 */
export function ImplantTabs({ site, patientId, data, justPlaced, selected, onSelect }: {
  site: ImplantSite; patientId: string; data: ChartData; justPlaced: boolean;
  selected: ImplantTabKey; onSelect: (tab: ImplantTabKey) => void;
}) {
  const live = (site.complications ?? []).filter((c) => !c.voided_at);
  const tabs = implantTabs({
    editable: correctable(site, data),
    surgery: surgeryCompleteness(site.surgery, site),
    complications: { total: live.length, open: live.filter(isOpen).length },
    restoration: currentRestoration(site.id, data.restorations)?.stage ?? null,
  }).filter((t) => (t.key !== 'surgery' && t.key !== 'restoration') || site.state !== 'removed');
  const current = tabs.some((t) => t.key === selected) ? selected : 'implant';
  const id = useId();
  const tabRefs = useRef<Partial<Record<ImplantTabKey, HTMLButtonElement | null>>>({});

  function onKeyDown(e: React.KeyboardEvent) {
    const next = tabAfterKey(e.key, current, tabs.map((t) => t.key));
    if (!next) return;
    e.preventDefault();
    onSelect(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className="space-y-4 text-sm">
      <div role="tablist" aria-label="Implant record" className="tabs" onKeyDown={onKeyDown}>
        {tabs.map((t) => (
          <button
            key={t.key}
            ref={(el) => { tabRefs.current[t.key] = el; }}
            type="button"
            role="tab"
            id={`${id}-${t.key}-tab`}
            aria-controls={`${id}-${t.key}`}
            aria-selected={t.key === current}
            tabIndex={t.key === current ? 0 : -1}
            className="tab"
            onClick={() => onSelect(t.key)}
          >
            {t.label}
            {t.badge && (
              <span className={`badge ${BADGE_TONE[t.badge.tone]} ml-1.5`}>
                <span aria-hidden="true">{t.badge.text}</span>
                <span className="sr-only">{t.badge.srText}</span>
              </span>
            )}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.key} role="tabpanel" id={`${id}-${t.key}`} aria-labelledby={`${id}-${t.key}-tab`} hidden={t.key !== current} tabIndex={0} className="space-y-3">
          {t.key === 'implant' && (
            <div data-testid="site-details" className="space-y-3">
              <ImplantFacts site={site} patientId={patientId} data={data} />
            </div>
          )}
          {t.key === 'surgery' && <SurgicalDetails site={site} patientId={patientId} editable={data.editable} startOpen={justPlaced} bare />}
          {t.key === 'restoration' && <Restorations site={site} patientId={patientId} data={data} />}
          {t.key === 'visits' &&<Visits site={site} visits={data.visits} />}
          {t.key === 'complications' && <Complications site={site} patientId={patientId} editable={data.editable} bare />}
          {t.key === 'corrections' && <Corrections patientId={patientId} site={site} data={data} bare />}
        </div>
      ))}
    </div>
  );
}
