import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth/session';
import { canEdit } from '@/lib/auth/permissions';
import { todayIso } from '@/lib/dates';
import { productLabel } from '@/lib/inventory/labels';
import type { ChartData, ImplantSite, LotOnHand, Product } from '@/lib/inventory/types';
import type { ToothState } from '@/lib/patients/types';
import type { VisitRow } from '@/lib/visits/visits';

export const SITE_SELECT = `
  id, tooth, state, technique, placed_on, torque_ncm, isq, bone_type, graft, notes, created_at, updated_at, failed_on, failure_type, failure_reason, failure_notes, stock_lot_id,
  placing_delegate_id, assisting_delegate_id, supervisor_id,
  product:products(*),
  lot:stock_lots(lot_no, expiry),
  placing:delegates!implant_sites_placing_delegate_id_fkey(full_name),
  assisting:delegates!implant_sites_assisting_delegate_id_fkey(full_name),
  supervisor:supervisors!implant_sites_supervisor_ref_fkey(full_name),
  components:site_components(
    id, component_type, fitted_on, removed_on, notes, voided_at, voided_reason, stock_lot_id,
    product:products(*), lot:stock_lots(lot_no),
    fitted_by_delegate:delegates(full_name),
    fitted_by_organizer:profiles!site_components_fitted_by_organizer_id_fkey(full_name, email)
  ),
  followups:implant_followups(
    id, date, check_type, outcome, notes, voided_at, voided_reason, visit_key, attendance, pain_score, patient_concerns,
    swelling, suppuration, plaque, mobility, probing_mesial, probing_buccal, probing_distal, probing_lingual,
    bop_mesial, bop_buccal, bop_distal, bop_lingual, isq, prosthesis_status, radiograph_taken, recommended_treatment
  ),
  surgery:implant_surgery(*),
  grafts:implant_grafts(*),
  complications:implant_complications(*),
  slot:surgery_slots(id, starts_at, supervisor_id, chair:chairs(name), delegates:slot_delegates(delegate_id, role))
`;

export function sortSite(site: ImplantSite): ImplantSite {
  const surgery = site.surgery as ImplantSite['surgery'] | ImplantSite['surgery'][] | undefined;
  return {
    ...site,
    components: [...site.components].sort((a, b) => (a.fitted_on < b.fitted_on ? -1 : a.fitted_on > b.fitted_on ? 1 : 0)),
    followups: [...site.followups].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    surgery: Array.isArray(surgery) ? surgery[0] ?? null : surgery ?? null,
    grafts: [...(site.grafts ?? [])].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0)),
    complications: [...(site.complications ?? [])].sort((a, b) => (a.noticed_on < b.noticed_on ? 1 : a.noticed_on > b.noticed_on ? -1 : 0)),
  };
}

export async function loadChartData(patientId: string): Promise<ChartData> {
  const supabase = await createClient();
  const me = await getCurrentProfile();
  const [statuses, sites, products, lots, delegates, organizers, supervisors, visits] = await Promise.all([
    supabase.from('tooth_status').select('tooth, status').eq('patient_id', patientId),
    supabase.from('implant_sites').select(SITE_SELECT).eq('patient_id', patientId).order('created_at'),
    supabase.from('products').select('*').eq('active', true),
    supabase.from('stock_on_hand').select('*').gt('on_hand', 0),
    supabase.from('delegates').select('id, full_name').eq('active', true).order('full_name'),
    supabase.from('profiles').select('user_id, full_name, email').eq('active', true).in('role', ['admin', 'organizer']).order('full_name'),
    supabase.from('supervisors').select('id, full_name').eq('active', true).order('full_name'),
    supabase.rpc('implant_visits', { p_patient: patientId }),
  ]);
  for (const r of [statuses, sites, products, lots, delegates, organizers, supervisors, visits]) {
    if (r.error) throw new Error('Could not load the chart');
  }
  const statusMap: Partial<Record<number, ToothState>> = {};
  for (const row of statuses.data ?? []) statusMap[row.tooth as number] = row.status as ToothState;
  const all = (products.data ?? []) as Product[];
  const byLabel = (a: Product, b: Product) => productLabel(a).localeCompare(productLabel(b), undefined, { numeric: true });
  return {
    statuses: statusMap,
    sites: ((sites.data ?? []) as unknown as ImplantSite[]).map(sortSite),
    visits: (visits.data ?? []) as VisitRow[],
    implants: all.filter((p) => p.type === 'implant').sort(byLabel),
    componentProducts: all.filter((p) => p.type !== 'implant').sort(byLabel),
    lots: (lots.data ?? []) as LotOnHand[],
    delegates: (delegates.data ?? []).map((d) => ({ id: d.id as string, label: d.full_name as string })),
    organizers: (organizers.data ?? []).map((o) => ({ id: o.user_id as string, label: (o.full_name || o.email) as string })),
    supervisors: (supervisors.data ?? []).map((s) => ({ id: s.id as string, label: s.full_name as string })),
    today: todayIso(),
    me: me?.user_id ?? '',
    editable: me ? canEdit(me, 'patients') : false,
    canReceive: me ? canEdit(me, 'inventory') : false,
  };
}
