import { activeSite } from '@/lib/inventory/components';
import {
  ANGULATION_DIRECTION_LABELS, type AngulationDirection, type ImplantSite, type ImplantType, IMPLANT_TYPE_LABELS,
} from '@/lib/inventory/types';
import { CHART_ORDER } from '@/lib/patients/fdi';
import { MIDLINE_X, TOOTH_W, toothLayout } from '@/components/odontogram/layout';
import type { Span } from '@/components/odontogram/odontogram';

export type ArchImplant = {
  siteId: string; tooth: number; jaw: 'upper' | 'lower';
  kind: ImplantType; planned: boolean; failed: boolean;
  /** Degrees drawn from vertical, 0 when upright. */
  angle: number;
  /** Drawn x direction of the apex: -1 left, 1 right. */
  lean: -1 | 0 | 1;
  label: string | undefined;
  badge: string | undefined;
  description: string;
};
export type ArchBridge = { id: string; teeth: number[]; implantTeeth: number[]; temporary: boolean; label: string };

export const IMPLANT_LENGTH: Record<ImplantType, number> = { conventional: 56, tilted: 56, zygomatic: 130, pterygoid: 80 };
const DEFAULT_ANGLE: Record<ImplantType, number> = { conventional: 0, tilted: 0, zygomatic: 45, pterygoid: 30 };

const CENTRES = new Map(toothLayout().map((b) => [b.fdi, b.x + TOOTH_W / 2]));

function drawnLean(tooth: number, direction: AngulationDirection | null): -1 | 0 | 1 {
  if (direction === 'buccal' || direction === 'palatal_lingual') return 0;
  const away = (CENTRES.get(tooth) ?? MIDLINE_X) < MIDLINE_X ? -1 : 1;
  return direction === 'mesial' ? (-away as -1 | 1) : away;
}

function geometryText(site: ImplantSite): string {
  if (site.angulation_deg === null) return '';
  const dir = site.angulation_direction ? ` ${ANGULATION_DIRECTION_LABELS[site.angulation_direction].toLowerCase()}` : '';
  return `${site.angulation_deg}°${dir}`;
}

export function fullArchModel(input: {
  sites: readonly ImplantSite[]; spans: readonly Span[];
  badges: Partial<Record<number, string>>; types: Partial<Record<number, string>>;
}): { implants: ArchImplant[]; bridges: ArchBridge[] } {
  const implants: ArchImplant[] = [];
  for (const jaw of ['upper', 'lower'] as const) {
    for (const tooth of CHART_ORDER[jaw]) {
      const site = activeSite(input.sites, tooth) ?? input.sites.find((s) => s.tooth === tooth && s.state === 'failed') ?? null;
      if (!site) continue;
      const planned = site.state === 'planned';
      const kind: ImplantType = site.implant_type
        ?? site.planned_product?.implant_kind ?? site.product?.implant_kind ?? 'conventional';
      let angle = 0;
      let lean: -1 | 0 | 1 = 0;
      if (!planned) {
        const direction = site.angulation_direction ?? (kind === 'zygomatic' || kind === 'pterygoid' ? 'distal' : null);
        angle = site.angulation_deg ?? DEFAULT_ANGLE[kind];
        lean = angle > 0 ? drawnLean(tooth, direction) : 0;
        if (lean === 0) angle = 0;
      }
      const geometry = planned ? '' : geometryText(site);
      implants.push({
        siteId: site.id, tooth, jaw, kind, planned, failed: site.state === 'failed', angle, lean,
        label: input.types[tooth], badge: input.badges[tooth],
        description: ['Implant ' + tooth, IMPLANT_TYPE_LABELS[kind], geometry, site.state].filter(Boolean).join(', '),
      });
    }
  }
  const bridges = input.spans.map((s) => ({ id: s.id, teeth: s.teeth, implantTeeth: s.implantTeeth, temporary: s.temporary, label: s.label }));
  return { implants, bridges };
}

export function implantLine(imp: ArchImplant, head: { x: number; y: number }): { x1: number; y1: number; x2: number; y2: number } {
  const len = IMPLANT_LENGTH[imp.kind];
  const rad = (imp.angle * Math.PI) / 180;
  const dir = imp.jaw === 'upper' ? -1 : 1;
  return { x1: head.x, y1: head.y, x2: head.x + imp.lean * Math.sin(rad) * len, y2: head.y + dir * Math.cos(rad) * len };
}
