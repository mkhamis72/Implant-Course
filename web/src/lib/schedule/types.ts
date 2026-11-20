import type { Product, Technique } from '@/lib/inventory/types';

export const SESSION_TYPES = ['lecture', 'workshop', 'surgery'] as const;
export type SessionType = (typeof SESSION_TYPES)[number];
export const SESSION_TYPE_LABELS: Record<SessionType, string> = { lecture: 'Lecture', workshop: 'Workshop', surgery: 'Surgery' };

/** Where a clinic booking happens (0122); null on course bookings and older rows. */
export const SETTINGS = ['clinic', 'hospital_ga'] as const;
export type Setting = (typeof SETTINGS)[number];
export const SETTING_LABELS: Record<Setting, string> = { clinic: 'In clinic', hospital_ga: 'GA in hospital' };

export type Course = { id: string; name: string; start_date: string; end_date: string; venue: string; notes: string };
export type Session = {
  id: string; course_id: string; type: SessionType; title: string; date: string;
  start_time: string; end_time: string; lead_organizer_id: string | null; room: string | null;
};
export type Chair = { id: string; name: string; active: boolean };
export type Supervisor = { id: string; full_name: string; active: boolean };
export type Lecturer = { id: string; full_name: string; active: boolean };

export type SlotRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: 'scheduled' | 'done' | 'cancelled';
  override_reason: string;
  cancel_reason: string;
  chair_id: string;
  chair: { name: string } | null;
  patient: { id: string; full_name: string; file_no: string } | null;
  supervisor: { full_name: string } | null;
  /** The doctor placing the implants (0115), instead of placing delegates; a clinic always has one. */
  doctor: { name: string } | null;
  session: { title: string; course: { name: string } | null } | null;
  delegates: { role: 'placing' | 'assisting'; delegate: { full_name: string } | null }[];
  notes: string;
  /** Null for a doctor booking without a supervisor, and always in a clinic. */
  supervisor_id: string | null;
  session_id: string;
  placing_doctor_id: string | null;
  /** Where a clinic booking happens (0122). */
  setting: Setting | null;
  implants: { tooth: number; product: Product | null; site: { id: string; technique: Technique | null } | null }[];
  checklists: { id: string; items: { done_at: string | null }[] }[];
};

export type PullRow = Pick<Product, 'type' | 'brand' | 'system' | 'platform' | 'diameter_mm' | 'length_mm' | 'description'> & {
  product_id: string | null;
  needed: number;
  available: number;
};

export type ReportRow = {
  site_id: string; role: 'placing' | 'assisting'; course_id: string | null; course_name: string | null;
  patient_id: string; patient_name: string; file_no: string; tooth: number; state: string; placed_on: string | null;
  product_id: string | null; type: Product['type'] | null; brand: string | null; system: string | null; platform: string | null;
  diameter_mm: number | null; length_mm: number | null; description: string | null; lot_no: string | null;
  last_outcome: string | null; technique: Technique | null;
};
/** user_id: the staff login linked to the doctor (0123), whose Placed by starts on them. */
export type Doctor = { id: string; name: string; active: boolean; user_id: string | null };
