import type { Product } from '@/lib/inventory/types';

export const SESSION_TYPES = ['lecture', 'workshop', 'surgery'] as const;
export type SessionType = (typeof SESSION_TYPES)[number];
export const SESSION_TYPE_LABELS: Record<SessionType, string> = { lecture: 'Lecture', workshop: 'Workshop', surgery: 'Surgery' };

export type Course = { id: string; name: string; start_date: string; end_date: string; venue: string; notes: string };
export type Session = {
  id: string; course_id: string; type: SessionType; title: string; date: string;
  start_time: string; end_time: string; lead_organizer_id: string | null;
};
export type Chair = { id: string; name: string; active: boolean };

export type SlotRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: 'scheduled' | 'done' | 'cancelled';
  override_reason: string;
  cancel_reason: string;
  chair_id: string;
  patient: { id: string; full_name: string; file_no: string } | null;
  supervisor: { full_name: string; email: string } | null;
  session: { title: string; course: { name: string } | null } | null;
  delegates: { role: 'placing' | 'assisting'; delegate: { full_name: string } | null }[];
  implants: { tooth: number; product: Product | null }[];
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
  last_outcome: string | null;
};
