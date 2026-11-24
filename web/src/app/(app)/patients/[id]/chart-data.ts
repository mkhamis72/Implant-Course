import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth/session';
import { staffOptions } from '@/lib/admin/staff';
import { canEdit } from '@/lib/auth/permissions';
import { featureOn, teachingOn } from '@/lib/modules/modules';
import { todayIso } from '@/lib/dates';
import { productLabel } from '@/lib/inventory/labels';
import { fetchAll } from '@/lib/catalog/fetch-all';
import type { ChartData, ImplantSite, LotOnHand, Product } from '@/lib/inventory/types';
import type { ToothState } from '@/lib/patients/types';
import type { VisitRow } from '@/lib/visits/visits';
import type { Enrollment } from '@/lib/inventory/enrolled';
import type { Radiograph } from '@/lib/radiographs/radiographs';
import { CASE_STAGES, type FullArchCase } from '@/lib/full-arch/cases';
import type { CourseOption, Restoration, RestorationProblem } from '@/lib/restorations/restorations';

export const SITE_SELECT = `
  id, tooth, state, technique, impression_type, impression_taken_on, placed_on, torque_ncm, isq, bone_type, graft, notes, created_at, updated_at, failed_on, failure_type, failure_reason, failure_notes, stock_lot_id,
  placing_delegate_id, assisting_delegate_id, supervisor_id, course_id, placing_doctor_id,
  implant_type, angulation_deg, angulation_direction, anchorage, entry_point, trajectory, planned_product_id, case_id,
  product:products!implant_sites_product_id_fkey(*),
  lot:stock_lots(lot_no, expiry),
  placing:delegates!implant_sites_placing_delegate_id_fkey(full_name),
  assisting:delegates!implant_sites_assisting_delegate_id_fkey(full_name),
  supervisor:supervisors!implant_sites_supervisor_ref_fkey(full_name),
  doctor:doctors!implant_sites_placing_doctor_id_fkey(name),
  components:site_components(
    id, component_type, fitted_on, removed_on, notes, voided_at, voided_reason, stock_lot_id, course_id, created_at,
    torque_ncm, holds_component_id, holds_restoration_id, replaced_by,
    product:products(*), lot:stock_lots(lot_no),
    fitted_by_delegate:delegates(full_name),
    fitted_by_organizer:profiles!site_components_fitted_by_organizer_id_fkey(full_name, email)
  ),
  followups:implant_followups(
    id, date, check_type, outcome, notes, voided_at, voided_reason, visit_key, attendance, pain_score, patient_concerns,
    swelling, suppuration, plaque, mobility, probing_mesial, probing_buccal, probing_distal, probing_lingual,
    bop_mesial, bop_buccal, bop_distal, bop_lingual, isq, prosthesis_status, radiograph_taken, recommended_treatment,
    recession_facial_mm, recession_mesial_mm, recession_distal_mm
  ),
  surgery:implant_surgery(*),
  grafts:implant_grafts(*),
  complications:implant_complications(*),
  slot:surgery_slots(id, starts_at, supervisor_id, placing_doctor_id, chair:chairs(name), delegates:slot_delegates(delegate_id, role))
`;

export function sortSite(site: ImplantSite): ImplantSite {
  const surgery = site.surgery as ImplantSite['surgery'] | ImplantSite['surgery'][] | undefined;
  return {
    ...site,
    // Fitting order: by date, then by when it was recorded (a replacement on the same day comes after what it replaced).
    components: [...site.components].sort((a, b) => a.fitted_on.localeCompare(b.fitted_on) || (a.created_at ?? '').localeCompare(b.created_at ?? '')),
    followups: [...site.followups].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    surgery: Array.isArray(surgery) ? surgery[0] ?? null : surgery ?? null,
    grafts: [...(site.grafts ?? [])].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0)),
    complications: [...(site.complications ?? [])].sort((a, b) => (a.noticed_on < b.noticed_on ? 1 : a.noticed_on > b.noticed_on ? -1 : 0)),
  };
}

export const CASE_SELECT = `
  id, arch, configuration, name, notes, closed_at, close_reason, updated_at,
  stages:full_arch_stages(stage, done_on, lab, passive_fit, occlusion, notes)
`;

/** Cases as loaded, their stages in the order of the process (scan, lab and design, try-in). */
export function toCases(rows: unknown): FullArchCase[] {
  return ((rows ?? []) as FullArchCase[]).map((c) => ({
    ...c,
    stages: [...(c.stages ?? [])].sort((a, b) => CASE_STAGES.indexOf(a.stage) - CASE_STAGES.indexOf(b.stage)),
  }));
}

export const RESTORATION_SELECT = `
  id, stage, type, teeth, fitted_on, retention, material, delegate_id, supervisor_id, course_id, notes,
  ended_on, end_kind, end_reason, updated_at, case_id,
  sites:restoration_sites(site_id),
  problems:restoration_problems(id, noticed_on, type, action, notes, updated_at, voided_at),
  delegate:delegates(full_name),
  supervisor:supervisors(full_name),
  course:courses(name)
`;

export type RestorationRow = Omit<Restoration, 'site_ids' | 'problems'> & {
  sites: { site_id: string }[];
  problems: (RestorationProblem & { voided_at: string | null })[];
};

/** Site ids flattened; voided problems left out, newest first. */
export function toRestoration({ sites, problems, ...r }: RestorationRow): Restoration {
  return {
    ...r,
    site_ids: sites.map((s) => s.site_id),
    problems: problems
      .filter((p) => !p.voided_at)
      .map((p) => ({ id: p.id, noticed_on: p.noticed_on, type: p.type, action: p.action, notes: p.notes, updated_at: p.updated_at }))
      .sort((a, b) => (a.noticed_on < b.noticed_on ? 1 : a.noticed_on > b.noticed_on ? -1 : 0)),
  };
}

/** Every row of a paged read, in the `{ data, error }` shape of a single one. */
function allRows<T>(page: Parameters<typeof fetchAll<T>>[0]): Promise<{ data: T[] | null; error: { message: string } | null }> {
  return fetchAll(page).then(
    (data) => ({ data, error: null }),
    (e: unknown) => ({ data: null, error: { message: e instanceof Error ? e.message : String(e) } }),
  );
}

export async function loadChartData(patientId: string): Promise<ChartData> {
  const supabase = await createClient();
  const me = await getCurrentProfile();
  const [statuses, sites, products, lots, delegates, organizers, supervisors, visits, restorations, courses, radiographs, enrollments, doctors, cases] = await Promise.all([
    supabase.from('tooth_status').select('tooth, status').eq('patient_id', patientId),
    supabase.from('implant_sites').select(SITE_SELECT).eq('patient_id', patientId).order('created_at'),
    // PostgREST caps a response at 1000 rows: page through products and stocked batches.
    allRows((from, to) => supabase.from('products').select('*').eq('active', true).order('id').range(from, to)),
    allRows((from, to) => supabase.from('stock_on_hand').select('*').gt('on_hand', 0).order('stock_lot_id').range(from, to)),
    supabase.from('delegates').select('id, full_name').eq('active', true).order('full_name'),
    staffOptions(supabase),
    supabase.from('supervisors').select('id, full_name').eq('active', true).order('full_name'),
    supabase.rpc('implant_visits', { p_patient: patientId }),
    supabase.from('restorations').select(RESTORATION_SELECT).eq('patient_id', patientId).is('voided_at', null),
    // Course choices for the pickers: course_options() needs View on Patients, like this page.
    supabase.rpc('course_options'),
    supabase.rpc('radiographs_for', { p_patient: patientId }),
    supabase.from('enrollments').select('course_id, delegate_id'),
    supabase.from('doctors').select('id, name, user_id, active').eq('active', true).order('name'),
    // Closed cases too: they keep their record; newest first.
    supabase.from('full_arch_cases').select(CASE_SELECT).eq('patient_id', patientId).order('created_at', { ascending: false }),
  ]);
  for (const r of [statuses, sites, products, lots, delegates, organizers, supervisors, visits, restorations, courses, radiographs, enrollments, doctors, cases]) {
    if (r.error) throw new Error('Could not load the chart');
  }
  const siteList = await withPlannedProducts(supabase, ((sites.data ?? []) as unknown as ImplantSite[]).map(sortSite));
  const spares = await sparesBySite(supabase, siteList);
  const statusMap: Partial<Record<number, ToothState>> = {};
  for (const row of statuses.data ?? []) statusMap[row.tooth as number] = row.status as ToothState;
  const all = (products.data ?? []) as Product[];
  const byLabel = (a: Product, b: Product) => productLabel(a).localeCompare(productLabel(b), undefined, { numeric: true });
  return {
    statuses: statusMap,
    sites: siteList,
    visits: (visits.data ?? []) as VisitRow[],
    implants: all.filter((p) => p.type === 'implant').sort(byLabel),
    componentProducts: all.filter((p) => p.type !== 'implant').sort(byLabel),
    lots: (lots.data ?? []) as LotOnHand[],
    delegates: (delegates.data ?? []).map((d) => ({ id: d.id as string, label: d.full_name as string })),
    enrollments: (enrollments.data ?? []) as Enrollment[],
    organizers: organizers.data ?? [],
    supervisors: (supervisors.data ?? []).map((s) => ({ id: s.id as string, label: s.full_name as string })),
    restorations: ((restorations.data ?? []) as unknown as RestorationRow[]).map(toRestoration),
    courses: (courses.data ?? []) as CourseOption[],
    radiographs: (radiographs.data ?? []) as unknown as Radiograph[],
    today: todayIso(),
    me: me?.user_id ?? '',
    editable: me ? canEdit(me, 'patients') : false,
    canReceive: me ? canEdit(me, 'inventory') : false,
    inventoryOn: me ? featureOn(me.features, 'inventory') : false,
    teachingOn: me ? teachingOn(me.features) : false,
    doctors: (doctors.data ?? []) as ChartData['doctors'],
    spares,
    cases: toCases(cases.data),
  };
}

/**
 * Each site's planned product, read by its own query (planned_product_id had no foreign key in 0141–0143; 0144 added
 * it back, so embeds of products from implant_sites must name their key).
 */
export async function withPlannedProducts(
  supabase: Pick<Awaited<ReturnType<typeof createClient>>, 'from'>, sites: ImplantSite[],
): Promise<ImplantSite[]> {
  const ids = [...new Set(sites.map((s) => s.planned_product_id).filter((id): id is string => !!id))];
  if (ids.length === 0) return sites.map((s) => ({ ...s, planned_product: null }));
  const { data, error } = await supabase.from('products').select('*').in('id', ids);
  if (error) throw new Error('Could not load the chart');
  const byId = new Map(((data ?? []) as Product[]).map((p) => [p.id, p]));
  return sites.map((s) => ({ ...s, planned_product: (s.planned_product_id && byId.get(s.planned_product_id)) || null }));
}

/** The spares each planned site's booking holds for its tooth (0125), by site id, in the order chosen. */
async function sparesBySite(
  supabase: Awaited<ReturnType<typeof createClient>>, sites: ImplantSite[],
): Promise<Record<string, Product[]>> {
  const planned = sites.filter((s) => s.state === 'planned' && s.slot);
  if (planned.length === 0) return {};
  const { data, error } = await supabase.from('slot_spare_implants')
    .select('slot_id, tooth, position, product:products(*)')
    .in('slot_id', [...new Set(planned.map((s) => s.slot!.id))]);
  if (error) throw new Error('Could not load the chart');
  type Row = { slot_id: string; tooth: number; position: number; product: Product | null };
  const rows = ((data ?? []) as unknown as Row[]).sort((a, b) => a.position - b.position);
  const out: Record<string, Product[]> = {};
  for (const s of planned) {
    const list = rows.filter((r) => r.slot_id === s.slot!.id && r.tooth === s.tooth && r.product).map((r) => r.product!);
    if (list.length) out[s.id] = list;
  }
  return out;
}
