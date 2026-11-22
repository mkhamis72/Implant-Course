import { formatDate } from '@/lib/format';
import { COMPONENT_BADGES, COMPONENT_LABELS, type ComponentRole, type ComponentType, type ImplantSite, type ProductType, type SiteComponent } from './types';

/** Mirrors app_private.component_accepts in the database. */
export const COMPONENT_ACCEPTS: Record<ComponentType, readonly ProductType[]> = {
  cover_screw: ['cover_screw'],
  healing_abutment: ['healing_abutment'],
  ti_base: ['ti_base'],
  multi_unit: ['multi_unit'],
  abutment: ['abutment_straight', 'abutment_angled'],
  final_restoration: ['other'],
  healing_cap: ['healing_cap'],
  temporary_abutment: ['temporary_abutment'],
  scan_body: ['scan_body'],
  impression_coping: ['impression_coping'],
  abutment_screw: ['abutment_screw'],
  prosthetic_screw: ['prosthetic_screw'],
  temporary_cylinder_screw: ['prosthetic_screw'],
};

export function acceptsProduct(component: ComponentType, product: ProductType): boolean {
  return COMPONENT_ACCEPTS[component].includes(product);
}

const ROLES: Record<ComponentType, ComponentRole> = {
  cover_screw: 'healing', healing_abutment: 'healing', healing_cap: 'cap',
  ti_base: 'abutment', multi_unit: 'abutment', abutment: 'abutment', temporary_abutment: 'abutment',
  abutment_screw: 'abutment_screw', prosthetic_screw: 'prosthetic_screw', temporary_cylinder_screw: 'prosthetic_screw',
  scan_body: 'transfer', impression_coping: 'transfer', final_restoration: 'legacy',
};

/** Mirrors app_private.component_role in the database. */
export function componentRole(type: ComponentType): ComponentRole {
  return ROLES[type];
}

const CURRENT_ORDER: ComponentRole[] = ['healing', 'abutment', 'cap', 'abutment_screw', 'prosthetic_screw'];

/** The parts on the implant now (not closed, not voided): healing, abutment, cap, abutment screw, prosthetic screw. */
export function currentComponents(site: ImplantSite): SiteComponent[] {
  return CURRENT_ORDER.flatMap((role) =>
    site.components.filter((c) => c.removed_on === null && c.voided_at === null && componentRole(c.component_type) === role),
  );
}

/** The current healing part or abutment (what the chart shows), or null. */
export function currentComponent(site: ImplantSite): SiteComponent | null {
  return currentComponents(site).find((c) => { const r = componentRole(c.component_type); return r === 'healing' || r === 'abutment'; }) ?? null;
}

/** Scan bodies and impression copings (recorded already closed) that are not voided: shown in history, undoable. */
export function transferComponents(site: ImplantSite): SiteComponent[] {
  return site.components.filter((c) => c.voided_at === null && componentRole(c.component_type) === 'transfer');
}

/** "Multi-unit abutment — 03 Nov 2026"; a scan body or impression coping: "Scan body — used 03 Nov 2026". */
export function partLabel(c: SiteComponent): string {
  const used = componentRole(c.component_type) === 'transfer' ? 'used ' : '';
  return `${COMPONENT_LABELS[c.component_type]} — ${used}${formatDate(c.fitted_on)}`;
}

/** What void_component accepts: the current parts, a current old crown record, then the transfers; `latest` is the last fitted of them. */
export function undoableComponents(site: ImplantSite): { options: SiteComponent[]; latest: SiteComponent | null } {
  const legacy = site.components.filter((c) => c.removed_on === null && c.voided_at === null && componentRole(c.component_type) === 'legacy');
  const options = [...currentComponents(site), ...legacy, ...transferComponents(site)];
  // site.components is in fitting order (chart-data sorts it), so among equal dates the later one wins.
  const order = (c: SiteComponent) => site.components.indexOf(c);
  const latest = options.reduce<SiteComponent | null>(
    (best, c) => (!best || c.fitted_on > best.fitted_on || (c.fitted_on === best.fitted_on && order(c) > order(best)) ? c : best),
    null,
  );
  return { options, latest };
}

export function activeSite(sites: readonly ImplantSite[], tooth: number): ImplantSite | null {
  return sites.find((s) => s.tooth === tooth && (s.state === 'planned' || s.state === 'placed' || s.state === 'restored')) ?? null;
}

export function badgesFor(sites: readonly ImplantSite[]): Partial<Record<number, string>> {
  const badges: Partial<Record<number, string>> = {};
  for (const site of sites) {
    if (site.state !== 'placed' && site.state !== 'restored') continue;
    const current = currentComponent(site);
    if (current) badges[site.tooth] = COMPONENT_BADGES[current.component_type];
  }
  return badges;
}

/** The latest follow-up that has not been removed. */
export function lastFollowup(site: ImplantSite): ImplantSite['followups'][number] | null {
  return site.followups.filter((f) => !f.voided_at).at(-1) ?? null;
}
