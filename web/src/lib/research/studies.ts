/** A study as studies_list() (0073) returns it: courses by start date; on_export is true only for admins. */
export type StudyRow = {
  id: string;
  title: string;
  committee: string | null;
  approval_number: string | null;
  approval_date: string | null;
  protocol_name: string | null;
  protocol_version: string | null;
  protocol_date: string | null;
  notes: string | null;
  has_letter: boolean;
  on_export: boolean;
  courses: { id: string; name: string; start_date: string }[];
};

export const studyLetterHref = (id: string) => `/statistics/studies/${id}/letter`;
