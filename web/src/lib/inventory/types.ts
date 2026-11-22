import type { ToothState } from '@/lib/patients/types';
import type { ImplantGraft, ImplantSurgery } from '@/lib/implants/surgery';
import type { ImplantComplication } from '@/lib/implants/complications';
import type { FailureReason, FailureType } from '@/lib/implants/failure';
import type { Attendance, VisitFindings, VisitRow } from '@/lib/visits/visits';
import type { CourseOption, Restoration } from '@/lib/restorations/restorations';
import type { Radiograph } from '@/lib/radiographs/radiographs';
import type { Enrollment } from './enrolled';

export const PRODUCT_TYPES = [
  'implant', 'cover_screw', 'healing_abutment', 'graft', 'membrane', 'ti_base', 'multi_unit',
  'abutment_straight', 'abutment_angled', 'scan_body', 'impression_coping', 'analog', 'prosthetic_screw', 'other',
] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  implant: 'Implant', cover_screw: 'Cover screw', healing_abutment: 'Healing abutment', graft: 'Bone graft',
  membrane: 'Membrane', ti_base: 'Ti-base', multi_unit: 'Multi-unit abutment', abutment_straight: 'Straight abutment',
  abutment_angled: 'Angled abutment', scan_body: 'Scan body', impression_coping: 'Impression coping', analog: 'Lab analog',
  prosthetic_screw: 'Prosthetic screw', other: 'Other',
};

export type Product = {
  id: string;
  type: ProductType;
  category: 'surgical' | 'prosthetic';
  brand: string;
  system: string;
  platform: string;
  diameter_mm: number | null;
  length_mm: number | null;
  ref_code: string;
  description: string;
  reorder_level: number;
  active: boolean;
  is_sample: boolean;
  /** Switched on from the catalogue library (0128): its catalogue fields are locked. */
  catalog_item_id?: string | null;
};

export type LotOnHand = {
  stock_lot_id: string;
  product_id: string;
  lot_no: string | null;
  expiry: string | null;
  received_on: string;
  qty_received: number;
  on_hand: number;
};

export const COMPONENT_TYPES = ['cover_screw', 'healing_abutment', 'ti_base', 'multi_unit', 'abutment', 'final_restoration'] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];
export const COMPONENT_LABELS: Record<ComponentType, string> = {
  cover_screw: 'Cover screw', healing_abutment: 'Healing abutment', ti_base: 'Ti-base', multi_unit: 'Multi-unit abutment',
  abutment: 'Abutment', final_restoration: 'Final restoration',
};
export const COMPONENT_BADGES: Record<ComponentType, string> = {
  cover_screw: 'CS', healing_abutment: 'HA', ti_base: 'TB', multi_unit: 'MUA', abutment: 'AB', final_restoration: 'CR',
};

export const SITE_STATES = ['planned', 'placed', 'restored', 'failed', 'removed'] as const;
export type SiteState = (typeof SITE_STATES)[number];
export const SITE_STATE_LABELS: Record<SiteState, string> = {
  planned: 'Planned', placed: 'Placed', restored: 'Restored', failed: 'Failed', removed: 'Cancelled',
};

export const TECHNIQUES = ['guided', 'free_hand'] as const;
export type Technique = (typeof TECHNIQUES)[number];
export const TECHNIQUE_LABELS: Record<Technique, string> = { guided: 'Guided', free_hand: 'Free hand' };

export const FOLLOWUP_OUTCOMES = ['ok', 'integrated', 'failed', 'complication'] as const;
export type FollowupOutcome = (typeof FOLLOWUP_OUTCOMES)[number];
export const OUTCOME_LABELS: Record<FollowupOutcome, string> = {
  ok: 'OK', integrated: 'Integrated', failed: 'Failed', complication: 'Complication',
};

export const MOVEMENT_REASON_LABELS: Record<string, string> = {
  receive: 'Received', use: 'Used', adjust: 'Adjusted', waste: 'Wasted', return: 'Returned',
};

export type Option = { id: string; label: string };
type Person = { full_name: string } | null;
type Organizer = { full_name: string; email: string } | null;

export type SiteComponent = {
  stock_lot_id: string | null;
  id: string;
  component_type: ComponentType;
  fitted_on: string;
  removed_on: string | null;
  notes: string;
  product: Product | null;
  lot: { lot_no: string | null } | null;
  fitted_by_delegate: Person;
  fitted_by_organizer: Organizer;
  /** Empty on older records. */
  course_id: string | null;
  voided_at: string | null;
  voided_reason: string;
};

export type Followup = VisitFindings & {
  id: string;
  date: string;
  check_type: string;
  outcome: FollowupOutcome | null;
  notes: string;
  voided_at: string | null;
  voided_reason: string;
  visit_key: string | null;
  attendance: Attendance | null;
};

export type ImplantSite = {
  id: string;
  tooth: number;
  state: SiteState;
  technique: Technique | null;
  impression_type: 'digital_scan' | 'conventional' | null;
  impression_taken_on: string | null;
  placed_on: string | null;
  stock_lot_id: string | null;
  torque_ncm: number | null;
  isq: number | null;
  bone_type: string | null;
  graft: string;
  notes: string;
  product: Product | null;
  lot: { lot_no: string | null; expiry: string | null } | null;
  placing_delegate_id: string | null;
  /** Placed by a doctor instead of a delegate (0115). */
  placing_doctor_id: string | null;
  doctor: { name: string } | null;
  assisting_delegate_id: string | null;
  supervisor_id: string | null;
  course_id: string | null;
  placing: Person;
  assisting: Person;
  supervisor: { full_name: string } | null;
  components: SiteComponent[];
  followups: Followup[];
  surgery: ImplantSurgery | null;
  grafts: ImplantGraft[];
  updated_at: string;
  failed_on: string | null;
  failure_type: FailureType | null;
  failure_reason: FailureReason | null;
  failure_notes: string;
  complications: ImplantComplication[];
  slot: {
    id: string;
    starts_at: string;
    supervisor_id: string | null;
    /** The booking's doctor (0115), who places it unless someone else is chosen. */
    placing_doctor_id?: string | null;
    chair: { name: string } | null;
    delegates: { delegate_id: string; role: 'placing' | 'assisting' }[];
  } | null;
  created_at: string;
};

export type ChartData = {
  statuses: Partial<Record<number, ToothState>>;
  sites: ImplantSite[];
  visits: VisitRow[];
  implants: Product[];
  componentProducts: Product[];
  lots: LotOnHand[];
  delegates: Option[];
  enrollments: Enrollment[];
  organizers: Option[];
  supervisors: Option[];
  /** The patient's restorations (voided ones left out), each with its implants and live problems. */
  restorations: Restoration[];
  /** The patient's X-rays (voided ones left out) with their bone levels, from radiographs_for. */
  radiographs: Radiograph[];
  /** Course pickers (placement, corrections, restoration), from course_options(): newest first. */
  courses: CourseOption[];
  today: string;
  me: string;
  /** Patients/edit: false shows the chart read-only. */
  editable: boolean;
  /** Inventory/edit: may receive missing stock from inside the placement form. */
  canReceive: boolean;
  /** The company's plan includes Inventory: false places and fits from the catalogue, with no stock batch. */
  inventoryOn: boolean;
  /** The plan includes Teaching (a course organizer): false in a clinic, which records no course, delegate or supervisor. */
  teachingOn: boolean;
  /** Active doctors (Admin → Doctors), for Placed by; user_id: the linked login (Placed by starts on mine). */
  doctors: { id: string; name: string; user_id: string | null; active: boolean }[];
  /** Spare implants of each planned site's booking for its tooth, by site id (0125): offered when placing. */
  spares?: Record<string, Product[]>;
};
