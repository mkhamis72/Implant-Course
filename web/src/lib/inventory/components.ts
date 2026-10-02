import { COMPONENT_BADGES, type ComponentType, type ImplantSite, type ProductType, type SiteComponent } from './types';

/** Mirrors app_private.component_accepts in the database. */
export const COMPONENT_ACCEPTS: Record<ComponentType, readonly ProductType[]> = {
  cover_screw: ['cover_screw'],
  healing_abutment: ['healing_abutment'],
  ti_base: ['ti_base'],
  multi_unit: ['multi_unit'],
  abutment: ['abutment_straight', 'abutment_angled'],
  final_restoration: ['other'],
};

export function acceptsProduct(component: ComponentType, product: ProductType): boolean {
  return COMPONENT_ACCEPTS[component].includes(product);
}

export function currentComponent(site: ImplantSite): SiteComponent | null {
  return site.components.find((c) => c.removed_on === null) ?? null;
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
