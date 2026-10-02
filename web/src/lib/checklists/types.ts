export const SCOPES = ['general', 'lecture', 'workshop', 'surgery', 'surgery_booking'] as const;
export type ChecklistScope = (typeof SCOPES)[number];

export type Template = { id: string; name: string; applies_to: ChecklistScope; is_default: boolean; items: { text: string; position: number }[] };

export type ChecklistItem = {
  id: string;
  position: number;
  text: string;
  assignee_id: string | null;
  due_date: string | null;
  done_at: string | null;
  done_by_profile: { full_name: string; email: string } | null;
  assignee: { full_name: string; email: string } | null;
};

export type ChecklistSummary = {
  id: string;
  title: string;
  session: { id: string; title: string; date: string; course_id: string } | null;
  slot: { id: string; starts_at: string; patient: { full_name: string } | null } | null;
  items: { done_at: string | null; assignee_id: string | null }[];
};
