export const RECALL_STATUSES = ['overdue', 'due', 'missed'] as const;
export type RecallStatus = (typeof RECALL_STATUSES)[number];

/** One row of recall_list (0046). */
export type RecallRow = {
  patient_id: string;
  full_name: string;
  phone: string;
  site_id: string;
  tooth: number;
  visit_key: string;
  label: string;
  target_date: string;
  window_end: string;
  status: RecallStatus;
};

export function parseRecallStatuses(values: string[]): RecallStatus[] {
  const picked = RECALL_STATUSES.filter((s) => values.includes(s));
  return picked.length ? picked : [...RECALL_STATUSES];
}

export function recallCounts(rows: RecallRow[]): Record<RecallStatus, number> {
  return { overdue: rows.filter((x) => x.status === 'overdue').length, due: rows.filter((x) => x.status === 'due').length,
    missed: rows.filter((x) => x.status === 'missed').length };
}
