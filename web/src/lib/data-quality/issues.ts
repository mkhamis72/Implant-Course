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

export function issuesForSite(issues: DataQualityIssue[] | undefined, siteId: string): DataQualityIssue[] {
  return (issues ?? []).filter((i) => i.site_id === siteId);
}
