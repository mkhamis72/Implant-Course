import {
  COMPONENT_LABELS, SITE_STATE_LABELS, type ComponentType, type FollowupOutcome, type SiteState,
} from '@/lib/inventory/types';
import { GRAFT_PROCEDURE_LABELS, SURGERY_FIELD_LABELS, type GraftProcedure } from '@/lib/implants/surgery';
import { visitResult, type Attendance } from '@/lib/visits/visits';
import { STATE_LABELS, type HistoryEntry, type ToothState } from './types';

const FIELD_LABELS: Record<string, string> = {
  full_name: 'name', file_no: 'file number', dob: 'date of birth', sex: 'sex', phone: 'phone', email: 'email',
  address: 'address', allergies: 'allergies', medications: 'medications', diabetes: 'diabetes', smoker: 'smoking',
  bisphosphonates: 'bisphosphonates', anticoagulants: 'anticoagulants', radiotherapy_head_neck: 'head/neck radiotherapy',
  osteoporosis: 'osteoporosis', other_conditions: 'other conditions', notes: 'notes',
  smoking: 'smoking', cigarettes_per_day: 'cigarettes per day', diabetes_status: 'diabetes', hba1c: 'HbA1c', hba1c_date: 'HbA1c date',
  bisphosphonates_status: 'bisphosphonates', anticoagulants_status: 'anticoagulants', radiotherapy_status: 'head/neck radiotherapy',
  osteoporosis_status: 'osteoporosis', periodontitis_history: 'periodontitis history', bruxism: 'bruxism',
  previous_implant_failure: 'previous implant failure',
};

/** Placement details an implant correction can change (correct_placement, 0042). */
const SITE_FIELD_LABELS: Record<string, string> = {
  placed_on: 'placement date', placing_delegate_id: 'placed by', assisting_delegate_id: 'assisted by',
  supervisor_id: 'supervisor', torque_ncm: 'torque', isq: 'ISQ', bone_type: 'bone type', graft: 'graft', notes: 'notes',
};

function changedFields(
  before: Record<string, unknown> | null, after: Record<string, unknown> | null, labels: Record<string, string> = FIELD_LABELS,
): string[] {
  if (!before || !after) return [];
  return [...new Set(
    Object.keys(labels)
      .filter((key) => key in after && JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      .map((key) => labels[key]),
  )];
}

function stateLabel(value: unknown): string {
  return STATE_LABELS[(value as ToothState) ?? 'present'] ?? String(value);
}

export function describeChange(e: HistoryEntry): string {
  const fields = changedFields(e.before, e.after);
  switch (e.table_name) {
    case 'patients': {
      if (e.action === 'INSERT') return 'Patient created';
      if (e.action === 'DELETE') return 'Patient deleted';
      if (e.before?.archived !== e.after?.archived) return e.after?.archived ? 'Patient archived' : 'Patient restored';
      return fields.length ? `Patient details changed: ${fields.join(', ')}` : 'Patient details saved (no changes)';
    }
    case 'medical_history': {
      if (e.action === 'INSERT') return 'Medical history started';
      return fields.length ? `Medical history changed: ${fields.join(', ')}` : 'Medical history saved (no changes)';
    }
    case 'tooth_status': {
      const tooth = (e.after ?? e.before)?.tooth;
      return `Tooth ${tooth}: ${stateLabel(e.before?.status)} → ${stateLabel(e.after?.status)}`;
    }
    case 'visit_notes': {
      const teeth = (e.after?.teeth as number[] | undefined) ?? [];
      return teeth.length ? `Note added (teeth ${teeth.join(', ')})` : 'Note added';
    }
    case 'implant_sites': {
      const tooth = (e.after ?? e.before)?.tooth;
      const label = (v: unknown) => SITE_STATE_LABELS[v as SiteState] ?? String(v);
      if (e.action === 'INSERT' || !e.before) return `Implant on tooth ${tooth}: ${label(e.after?.state)}`;
      if (e.before.state === e.after?.state) {
        const corrected = changedFields(e.before, e.after, SITE_FIELD_LABELS);
        return corrected.length ? `Implant on tooth ${tooth} corrected: ${corrected.join(', ')}` : `Implant on tooth ${tooth} updated`;
      }
      return `Implant on tooth ${tooth}: ${label(e.before.state)} → ${label(e.after?.state)}`;
    }
    case 'site_components': {
      const row = e.after ?? e.before;
      const label = COMPONENT_LABELS[row?.component_type as ComponentType] ?? String(row?.component_type);
      if (e.after?.voided_at && !e.before?.voided_at) return `Component removed from the record: ${label} (${e.after.voided_reason})`;
      return e.action === 'INSERT' ? `Component fitted: ${label}` : `Component updated: ${label}`;
    }
    case 'implant_followups': {
      const row = e.after ?? e.before;
      if (e.after?.voided_at && !e.before?.voided_at) return `Follow-up removed from the record: ${row?.check_type} (${e.after.voided_reason})`;
      const outcome = visitResult({ outcome: (row?.outcome ?? null) as FollowupOutcome | null, attendance: (row?.attendance ?? null) as Attendance | null });
      return e.action === 'INSERT' ? `Follow-up (${row?.check_type}): ${outcome}` : `Follow-up updated (${row?.check_type})`;
    }
    case 'implant_surgery': {
      if (e.action === 'INSERT') return 'Surgical details recorded';
      if (e.action === 'DELETE') return 'Surgical details deleted';
      const changed = changedFields(e.before, e.after, SURGERY_FIELD_LABELS);
      return changed.length ? `Surgical details changed: ${changed.join(', ')}` : 'Surgical details saved (no changes)';
    }
    case 'implant_grafts': {
      const procedure = (e.after ?? e.before)?.procedure as GraftProcedure;
      const label = GRAFT_PROCEDURE_LABELS[procedure] ?? String(procedure);
      if (e.action === 'INSERT') return `Graft added: ${label}`;
      if (e.action === 'DELETE') return `Graft deleted: ${label}`;
      return `Graft changed: ${label}`;
    }
    default:
      return `${e.table_name} ${e.action.toLowerCase()}`;
  }
}
