import { fmtMm, productLabel } from '@/lib/inventory/labels';
import { PRODUCT_TYPE_LABELS, type Product, type ProductType } from '@/lib/inventory/types';

/** A row of the shared library, public.catalog_items (0128). */
export type CatalogItem = {
  id: string; type: ProductType; brand: string; system: string; platform: string;
  diameter_mm: number | null; length_mm: number | null; ref_code: string; description: string; retired: boolean;
};
/** One of the company's products, linked to a library item or entered by hand. */
export type CompanyProduct = Pick<Product,
  'id' | 'type' | 'brand' | 'system' | 'platform' | 'diameter_mm' | 'length_mm' | 'ref_code' | 'description' | 'active' | 'is_sample'
> & { catalog_item_id: string | null };

export type CatalogRow = { itemId: string; label: string; refCode: string; on: boolean; retired: boolean };
export type TypeGroup = { type: ProductType; rows: CatalogRow[] };
export type PlatformGroup = { platform: string; types: TypeGroup[] };
export type SystemGroup = { system: string; on: number; total: number; platforms: PlatformGroup[] };
export type BrandGroup = { brand: string; on: number; total: number; systems: SystemGroup[] };
export type OwnRow = { productId: string; label: string; on: boolean };
export type CatalogGroup = { brands: BrandGroup[]; own: OwnRow[] };

const TYPE_ORDER = Object.keys(PRODUCT_TYPE_LABELS) as ProductType[];

/** "Ø4.0 × 10 mm", then the description; with neither, the ref code. */
export function itemLabel(i: Pick<CatalogItem, 'diameter_mm' | 'length_mm' | 'description' | 'ref_code'>): string {
  const size = i.diameter_mm !== null && i.length_mm !== null
    ? `Ø${fmtMm(i.diameter_mm, 1)} × ${fmtMm(i.length_mm, 0)} mm` : '';
  return [size, i.description].filter(Boolean).join(' · ') || i.ref_code;
}

function bucket<T>(list: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const t of list) m.set(key(t), [...(m.get(key(t)) ?? []), t]);
  return m;
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** The Admin → Catalogue tree. An item is on when the company has an active product linked to it. Retired items
 *  are listed only while on (so they can be switched off) and never counted. Hand-entered products (no link) go
 *  to `own`; inactive sample products (0008) are left out. */
export function groupCatalog(items: CatalogItem[], products: CompanyProduct[]): CatalogGroup {
  const onIds = new Set(products.filter((p) => p.active && p.catalog_item_id).map((p) => p.catalog_item_id!));
  const shown = items.filter((i) => !i.retired || onIds.has(i.id));
  const counted = (list: CatalogItem[]) => {
    const live = list.filter((i) => !i.retired);
    return { on: live.filter((i) => onIds.has(i.id)).length, total: live.length };
  };

  const brands: BrandGroup[] = [...bucket(shown, (i) => i.brand)].sort(([a], [b]) => byName(a, b)).map(([brand, bItems]) => ({
    brand,
    ...counted(bItems),
    systems: [...bucket(bItems, (i) => i.system)].sort(([a], [b]) => byName(a, b)).map(([system, sItems]) => ({
      system,
      ...counted(sItems),
      platforms: [...bucket(sItems, (i) => i.platform)].map(([platform, pItems]) => ({
        platform,
        types: [...bucket(pItems, (i) => i.type)]
          .sort(([a], [b]) => TYPE_ORDER.indexOf(a as ProductType) - TYPE_ORDER.indexOf(b as ProductType))
          .map(([type, tItems]) => ({
            type: type as ProductType,
            rows: tItems.map((i) => ({ itemId: i.id, label: itemLabel(i), refCode: i.ref_code, on: onIds.has(i.id), retired: i.retired })),
          })),
      })),
    })),
  }));

  const own = products
    .filter((p) => !p.catalog_item_id && (!p.is_sample || p.active))
    .map((p) => ({ productId: p.id, label: productLabel(p), on: p.active }));
  return { brands, own };
}
