import {
  ANCHORAGE_LABELS, ANGULATION_DIRECTION_LABELS, IMPLANT_TYPE_LABELS,
  type ImplantSite, type ImplantType,
} from '@/lib/inventory/types';

const SHORT_LABELS: Record<ImplantType, string> = { conventional: '', tilted: 'TLT', zygomatic: 'ZYG', pterygoid: 'PTG' };

/** The chart and table tag of a type: none for conventional or a planned implant (no type yet). */
export function typeShortLabel(type: ImplantType | null): string {
  return type ? SHORT_LABELS[type] : '';
}

/** Zygomatic and pterygoid implants are anchored in bone other than the jaw ridge. */
export function isAnchored(type: ImplantType | null): boolean {
  return type === 'zygomatic' || type === 'pterygoid';
}

type TypeFields = Pick<ImplantSite, 'implant_type' | 'angulation_deg' | 'angulation_direction' | 'anchorage'>;

/** "Zygomatic · 45° distal · Zygoma"; empty for a conventional implant with no angle (and for none yet). */
export function typeLine(site: TypeFields): string {
  if (!site.implant_type) return '';
  const parts: string[] = [];
  if (site.implant_type !== 'conventional') parts.push(IMPLANT_TYPE_LABELS[site.implant_type]);
  if (site.angulation_deg !== null) {
    const direction = site.angulation_direction ? ` ${ANGULATION_DIRECTION_LABELS[site.angulation_direction].toLowerCase()}` : '';
    parts.push(`${site.angulation_deg}°${direction}`);
  }
  if (site.anchorage) parts.push(ANCHORAGE_LABELS[site.anchorage]);
  if (site.implant_type === 'conventional' && parts.length) parts.unshift(IMPLANT_TYPE_LABELS.conventional);
  return parts.join(' · ');
}

/** The short label of each tooth's active implant (failed and cancelled ones do not count); teeth without one are left out. */
export function typeLabels(sites: Pick<ImplantSite, 'tooth' | 'state' | 'implant_type'>[]): Partial<Record<number, string>> {
  const out: Partial<Record<number, string>> = {};
  for (const s of sites) {
    if (s.state === 'failed' || s.state === 'removed') continue;
    const label = typeShortLabel(s.implant_type);
    if (label) out[s.tooth] = label;
  }
  return out;
}
