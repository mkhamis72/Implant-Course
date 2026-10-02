import { PRODUCT_TYPE_LABELS, type Product } from '../src/lib/inventory/types';

export type CatalogProduct = Pick<Product,
  'type' | 'brand' | 'system' | 'platform' | 'diameter_mm' | 'length_mm' | 'ref_code' | 'description' | 'is_sample' | 'active'>;

export const CATALOG_HEADERS = ['Type', 'Brand', 'System', 'Platform', 'Diameter (mm)', 'Length (mm)', 'Ref code', 'Description', 'Sample', 'Active'];

export function catalogRow(p: CatalogProduct): (string | number | null)[] {
  return [
    PRODUCT_TYPE_LABELS[p.type], p.brand, p.system, p.platform, p.diameter_mm, p.length_mm, p.ref_code, p.description,
    p.is_sample ? 'yes — verify' : 'no', p.active ? 'yes' : 'no',
  ];
}
