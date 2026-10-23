export type DataQualityKind = 'before_placement' | 'in_future' | 'problem_before_fitting';

/** One row of `data_quality_issues()`: an impossible date. The SQL decides what is flagged. */
export type DataQualityIssue = {
  patient_id: string;
  patient_name: string;
  file_no: string;
  site_id: string | null;
  tooth: number | null;
  kind: DataQualityKind;
  record_table: string;
  record_id: string;
  record_date: string;
  reference_date: string | null;
  message: string;
};

/** Where the record can be fixed: X-rays have their own page, everything else sits on the tooth panel. */
export function issueLink(issue: Pick<DataQualityIssue, 'patient_id' | 'tooth' | 'record_table'>): string {
  if (issue.record_table === 'radiographs') return `/patients/${issue.patient_id}/xrays`;
  return issue.tooth == null ? `/patients/${issue.patient_id}` : `/patients/${issue.patient_id}?tooth=${issue.tooth}`;
}

/** The tooth panel's issues: any implant on the tooth (current, failed or removed), and the tooth's own records. */
export function issuesForTooth(
  issues: DataQualityIssue[] | undefined,
  sites: readonly { id: string; tooth: number }[],
  tooth: number,
): DataQualityIssue[] {
  const ids = new Set(sites.filter((s) => s.tooth === tooth).map((s) => s.id));
  return (issues ?? []).filter((i) => (i.site_id == null ? i.tooth === tooth : ids.has(i.site_id)));
}

/** Page order: patient name, then tooth (no tooth last), then the record's date. */
export function sortIssues(issues: DataQualityIssue[]): DataQualityIssue[] {
  return [...issues].sort(
    (a, b) =>
      a.patient_name.localeCompare(b.patient_name) ||
      (a.tooth ?? Infinity) - (b.tooth ?? Infinity) ||
      a.record_date.localeCompare(b.record_date),
  );
}
