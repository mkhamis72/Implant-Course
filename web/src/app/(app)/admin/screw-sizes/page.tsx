import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { fetchAll } from '@/lib/catalog/fetch-all';
import { groupScrewSizes, systemKey, type ScrewSize } from '@/lib/admin/screw-sizes';
import { ScrewSizeForm, type SystemOption } from './screw-size-form';
import { ScrewSizeRow } from './screw-size-row';

export default async function ScrewSizesPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [sizes, implants] = await Promise.all([
    fetchAll<ScrewSize>((from, to) =>
      supabase.from('screw_sizes')
        .select('id, brand, system, kind, label, driver_interface, driver_size, driver_ref, torque_ncm, active')
        .order('brand').order('system').order('kind').order('label').order('id').range(from, to)),
    fetchAll<{ brand: string; system: string | null }>((from, to) =>
      supabase.from('products').select('brand, system').eq('type', 'implant').eq('active', true)
        .order('brand').order('system').order('id').range(from, to)),
  ]);
  // The company's implant systems; a system that already has sizes stays listed even when its products are off.
  const seen = new Map<string, SystemOption>();
  for (const p of implants) if (p.brand && p.system) seen.set(systemKey(p.brand, p.system), { brand: p.brand, system: p.system });
  for (const s of sizes) seen.set(systemKey(s.brand, s.system), { brand: s.brand, system: s.system });
  const systems = [...seen.values()].sort((a, b) => a.brand.localeCompare(b.brand) || a.system.localeCompare(b.system));
  const groups = groupScrewSizes(sizes);
  return (
    <div className="space-y-6">
      <h1>Screw sizes</h1>
      <p className="text-muted">
        The abutment and prosthetic screw sizes of each implant system, with the screwdriver and recommended torque. They are
        offered when a screw is fitted and printed on the implant passport. Switching a size off keeps past records.
      </p>
      {systems.length === 0 ? (
        <p className="card text-muted">Add implant products in Admin → Catalogue first, then their screw sizes here.</p>
      ) : (
        <ScrewSizeForm systems={systems} />
      )}
      {groups.map((g) => (
        <section key={systemKey(g.brand, g.system)} className="card space-y-2">
          <h2>{g.brand} · {g.system}</h2>
          <table className="table">
            <thead>
              <tr><th>Kind</th><th>Size</th><th>Screwdriver</th><th>Torque</th><th>Active</th><th></th></tr>
            </thead>
            <tbody>
              {g.sizes.map((s) => <ScrewSizeRow key={s.id} size={s} systems={systems} />)}
            </tbody>
          </table>
        </section>
      ))}
      {groups.length === 0 && <p className="text-muted">No screw sizes yet.</p>}
    </div>
  );
}
