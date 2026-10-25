// The return columns of the eight research_export_* readers, copied from supabase/migrations/0070_research_export.sql
// (create function ... returns table (...)). When a reader gains a column, add it here and to DICTIONARY.
// visits: latest in 0077_export_recession.sql.
export const READER_COLUMNS: Record<string, string[]> = {
  implants: ['implant_code', 'patient_code', 'course_code', 'tooth', 'jaw', 'placed_on', 'technique', 'brand', 'system',
    'diameter_mm', 'length_mm', 'placing_delegate_code', 'supervisor_code', 'extraction_date', 'placement_timing',
    'soft_tissue_phenotype', 'keratinized_mucosa_mm', 'flap', 'torque_type', 'healing', 'primary_closure',
    'grafting_performed', 'torque_ncm', 'isq', 'bone_type', 'impression_type', 'impression_taken_on', 'failure_type',
    'failed_on', 'loaded_on', 'last_contact', 'follow_up_days', 'event', 'event_on', 'event_time_unknown', 'at_loading',
    'year_1', 'year_2', 'year_3', 'year_5', 'latest_grade', 'latest_grade_on', 'latest_grade_reason', 'ungraded_later',
    'biological_complications', 'mechanical_complications', 'version'],
  patients: ['patient_code', 'sex', 'age_at_first_placement', 'smoking', 'cigarettes_per_day', 'diabetes_status', 'hba1c',
    'hba1c_date', 'bisphosphonates_status', 'anticoagulants_status', 'radiotherapy_status', 'osteoporosis_status',
    'periodontitis_history', 'bruxism', 'previous_implant_failure'],
  visits: ['implant_code', 'patient_code', 'date', 'visit_key', 'attendance', 'outcome', 'pain_score', 'swelling',
    'suppuration', 'plaque', 'mobility', 'probing_mesial', 'probing_buccal', 'probing_distal', 'probing_lingual',
    'bop_mesial', 'bop_buccal', 'bop_distal', 'bop_lingual', 'recession_facial_mm', 'recession_mesial_mm',
    'recession_distal_mm', 'isq', 'prosthesis_status', 'radiograph_taken'],
  radiographs: ['implant_code', 'patient_code', 'tooth', 'taken_on', 'type', 'purpose', 'mesial_mm', 'distal_mm'],
  complications: ['implant_code', 'patient_code', 'category', 'type', 'noticed_on', 'resolved_on', 'severity'],
  restorations: ['restoration_code', 'patient_code', 'implant_codes', 'stage', 'type', 'teeth', 'fitted_on', 'retention',
    'material', 'delegate_code', 'supervisor_code', 'ended_on', 'end_kind'],
  restoration_problems: ['restoration_code', 'patient_code', 'noticed_on', 'type', 'action'],
  grafts: ['implant_code', 'patient_code', 'procedure', 'timing', 'performed_on', 'material', 'membrane'],
};
