import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { groupCatalog, type CatalogItem, type CompanyProduct } from '@/lib/catalog/group';
import { fetchAll } from '@/lib/catalog/fetch-all';
import { CatalogueForm } from './catalogue-form';

export default async function CataloguePage() {
  await requireAdmin();
  const supabase = await createClient();
  // Paged: the library passes PostgREST's 1000-row cap as catalogues are loaded. Each order ends with id (a total order).
  const [items, products] = await Promise.all([
    fetchAll<CatalogItem>((from, to) => supabase.from('catalog_items')
      .select('id, type, brand, system, platform, diameter_mm, length_mm, ref_code, description, retired')
      .order('brand').order('system').order('platform').order('type').order('diameter_mm').order('length_mm')
      .order('ref_code').order('id').range(from, to)),
    fetchAll<CompanyProduct>((from, to) => supabase.from('products')
      .select('id, type, brand, system, platform, diameter_mm, length_mm, ref_code, description, active, is_sample, catalog_item_id')
      .order('brand').order('system').order('description').order('id').range(from, to)),
  ]).catch(() => { throw new Error('Could not load the catalogue'); });
  const group = groupCatalog(items, products);
  return (
    <div className="space-y-6">
      <h1>Catalogue</h1>
      <p className="text-muted">
        Switch on the products your centre uses. Switched-off products are hidden from booking, the implant chart and
        receiving stock.
      </p>
      <CatalogueForm group={group} />
    </div>
  );
}
