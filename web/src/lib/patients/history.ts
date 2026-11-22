import {
  COMPONENT_LABELS, SITE_STATE_LABELS, type ComponentType, type FollowupOutcome, type SiteState,
} from '@/lib/inventory/types';
import { GRAFT_PROCEDURE_LABELS, SURGERY_FIELD_LABELS, type GraftProcedure } from '@/lib/implants/surgery';
import { impressionSummary, type ImpressionType } from '@/lib/implants/impression';
import { TYPE_LABELS } from '@/lib/implants/complications';
import { FAILURE_REASON_LABELS, FAILURE_TYPE_LABELS, type FailureReason, type FailureType } from '@/lib/implants/failure';
import { PROBLEM_ACTION_LABELS, PROBLEM_TYPE_LABELS, RESTORATION_TYPE_LABELS, STAGE_LABELS, describeTeeth } from '@/lib/restorations/restorations';
import { RADIOGRAPH_PURPOSE_LABELS, RADIOGRAPH_TYPE_LABELS, boneLevelLabel, type RadiographPurpose, type RadiographType } from '@/lib/radiographs/radiographs';
import { visitResult, type Attendance } from '@/lib/visits/visits';
import { formatDate } from '@/lib/format';
import { STATE_LABELS, type HistoryEntry, type ToothState } from './types';

const FAILURE_FIELD_LABELS: Record<string, string> = { failed_on: 'failure date', failure_type: 'failure type', failure_reason: 'failure reason', failure_notes: 'failure notes' };

// diabetes, smoker, bisphosphonates, anticoagulants, radiotherapy_head_neck and osteoporosis were dropped in 0050;
// their labels stay so older History entries still name the change.
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

/** Placement details an implant correction can change (correct_placement, 0042; a doctor and the course since 0114). */
const PLACEMENT_FIELD_LABELS: Record<string, string> = {
  placed_on: 'placement date', placing_delegate_id: 'placed by', placing_doctor_id: 'placed by',
  assisting_delegate_id: 'assisted by', supervisor_id: 'supervisor', course_id: 'course', graft: 'graft', notes: 'notes',
};

/** Teaching details: a clinic (no teaching) never shows them, so its History doesn't name them either. */
const TEACHING_FIELDS = new Set(['placing_delegate_id', 'assisting_delegate_id', 'delegate_id', 'supervisor_id', 'course_id']);

/** Stability values are recorded in Surgical details (save_implant_surgery_v2, 0053); older corrections may name them too. */
const STABILITY_FIELD_LABELS: Record<string, string> = { torque_ncm: 'torque', isq: 'ISQ', bone_type: 'bone type' };
const SITE_FIELD_LABELS: Record<string, string> = { ...PLACEMENT_FIELD_LABELS, ...STABILITY_FIELD_LABELS };

const RESTORATION_FIELD_LABELS: Record<string, string> = {
  retention: 'retention', material: 'material', delegate_id: 'delegate', supervisor_id: 'supervisor', course_id: 'course', notes: 'notes',
};

const RADIOGRAPH_FIELD_LABELS: Record<string, string> = {
  taken_on: 'date', type: 'type', purpose: 'purpose', teeth: 'teeth', link: 'link', notes: 'notes',
};

/** Component details (0135): the torque a part was tightened to and what a screw holds. */
const COMPONENT_FIELD_LABELS: Record<string, string> = { torque_ncm: 'torque', holds_component_id: 'holds', holds_restoration_id: 'holds' };

const IMPRESSION_FIELD_LABELS: Record<string, string> = { impression_type: 'scan / impression', impression_taken_on: 'scan / impression date' };

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

/**
 * Link rows that only repeat what their restoration entry already says (the row holds no tooth to name), and the
 * step of remove_placement that stores the reason just before the implant is deleted (its delete says it all).
 */
/** fit_component_v3 closes a row, then sets its replaced_by: the closing update alone says nothing the next one doesn't. */
function onlyClosed(e: HistoryEntry): boolean {
  if (e.action !== 'UPDATE' || !e.before || !e.after) return false;
  const { before, after } = e;
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  return changed.length === 1 && changed[0] === 'removed_on' && before.removed_on == null && after.removed_on != null;
}

export const isHiddenFromHistory = (e: HistoryEntry) =>
  e.table_name === 'restoration_sites'
  || (e.table_name === 'implant_sites' && e.action === 'UPDATE' && !!e.after?.removal_reason && !e.before?.removal_reason)
  || (e.table_name === 'site_components' && onlyClosed(e));

/** `teaching: false` (a clinic) leaves out the teaching details (delegate, assisted by, supervisor, course). */
export function describeChange(e: HistoryEntry, { teaching = true }: { teaching?: boolean } = {}): string {
  const visible = (labels: Record<string, string>) =>
    teaching ? labels : Object.fromEntries(Object.entries(labels).filter(([key]) => !TEACHING_FIELDS.has(key)));
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
      if (e.action === 'DELETE') {
        return e.before?.removal_reason
          ? `Implant on tooth ${tooth} removed (entered by mistake): ${e.before.removal_reason}`
          : `Implant on tooth ${tooth} deleted`;
      }
      if (e.action === 'INSERT' || !e.before) return `Implant on tooth ${tooth}: ${label(e.after?.state)}`;
      if (e.after?.failure_type && !e.before.failure_type) {
        const type = FAILURE_TYPE_LABELS[e.after.failure_type as FailureType] ?? String(e.after.failure_type);
        const reason = FAILURE_REASON_LABELS[e.after.failure_reason as FailureReason] ?? String(e.after.failure_reason);
        return `Implant on tooth ${tooth}: failure recorded — ${type} (${reason})`;
      }
      if (e.after?.failure_type && e.before.failure_type) {
        const corrected = changedFields(e.before, e.after, FAILURE_FIELD_LABELS);
        if (corrected.length) return `Implant on tooth ${tooth}: failure details corrected: ${corrected.join(', ')}`;
      }
      if (e.before.state === e.after?.state) {
        const corrected = changedFields(e.before, e.after, visible(SITE_FIELD_LABELS));
        if (!changedFields(e.before, e.after, visible(PLACEMENT_FIELD_LABELS)).length) {
          if (changedFields(e.before, e.after, IMPRESSION_FIELD_LABELS).length) {
            if (!e.after?.impression_type) return `Implant on tooth ${tooth}: scan / impression cleared`;
            const summary = impressionSummary({
              impression_type: e.after.impression_type as ImpressionType,
              impression_taken_on: (e.after.impression_taken_on as string | null) ?? null,
            });
            return `Implant on tooth ${tooth}: scan / impression recorded — ${summary}`;
          }
          const stability = changedFields(e.before, e.after, STABILITY_FIELD_LABELS);
          if (stability.length) return `Implant on tooth ${tooth}: stability recorded — ${stability.join(', ')}`;
        }
        return corrected.length ? `Implant on tooth ${tooth} corrected: ${corrected.join(', ')}` : `Implant on tooth ${tooth} updated`;
      }
      return `Implant on tooth ${tooth}: ${label(e.before.state)} → ${label(e.after?.state)}`;
    }
    case 'site_components': {
      const row = e.after ?? e.before;
      const label = COMPONENT_LABELS[row?.component_type as ComponentType] ?? String(row?.component_type);
      if (e.after?.voided_at && !e.before?.voided_at) return `Component removed from the record: ${label} (${e.after.voided_reason})`;
      if (e.action === 'INSERT') return `Component fitted: ${label}`;
      if (e.after?.replaced_by && !e.before?.replaced_by) return `Component replaced: ${label}`;
      if (e.before?.removed_on && e.before?.replaced_by && e.after && e.after.removed_on == null && e.after.replaced_by == null) {
        return `Component back in place: ${label}`;
      }
      const changed = changedFields(e.before, e.after, COMPONENT_FIELD_LABELS);
      return changed.length ? `Component updated: ${label} (${changed.join(', ')})` : `Component updated: ${label}`;
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
    case 'implant_complications': {
      const row = e.after ?? e.before;
      const label = row?.type === 'other' && row?.other_type ? `Other: ${row.other_type}` : TYPE_LABELS[row?.type as string] ?? String(row?.type);
      if (e.action === 'INSERT') return `Complication recorded: ${label}`;
      if (e.after?.voided_at && !e.before?.voided_at) return `Complication removed from the record: ${label} (${e.after.voided_reason})`;
      if (e.after?.resolved_on && !e.before?.resolved_on) return `Complication resolved: ${label}`;
      return `Complication updated: ${label}`;
    }
    case 'restorations': {
      const row = e.after ?? e.before;
      if (e.after?.voided_at && !e.before?.voided_at) return `Restoration removed from the record (${e.after.voided_reason})`;
      if (e.action === 'INSERT') {
        const stage = STAGE_LABELS[row?.stage as keyof typeof STAGE_LABELS] ?? String(row?.stage);
        const type = (RESTORATION_TYPE_LABELS[row?.type as keyof typeof RESTORATION_TYPE_LABELS] ?? String(row?.type)).toLowerCase();
        return `Restoration added: ${stage} ${type} on ${describeTeeth((row?.teeth as number[] | undefined) ?? [])}`;
      }
      if (e.after?.end_kind && !e.before?.end_kind) {
        const on = formatDate(String(e.after.ended_on));
        return e.after.end_kind === 'remade' ? `Restoration remade on ${on} (${e.after.end_reason})` : `Restoration replaced on ${on}`;
      }
      if (e.before?.end_kind && !e.after?.end_kind) return 'Restoration reopened';
      const changed = changedFields(e.before, e.after, visible(RESTORATION_FIELD_LABELS));
      return changed.length ? `Restoration updated: ${changed.join(', ')}` : 'Restoration updated';
    }
    case 'restoration_problems': {
      const row = e.after ?? e.before;
      const type = PROBLEM_TYPE_LABELS[row?.type as keyof typeof PROBLEM_TYPE_LABELS] ?? String(row?.type);
      if (e.after?.voided_at && !e.before?.voided_at) return `Restoration problem removed from the record: ${type} (${e.after.voided_reason})`;
      const action = PROBLEM_ACTION_LABELS[row?.action as keyof typeof PROBLEM_ACTION_LABELS] ?? String(row?.action);
      return `Restoration problem ${e.action === 'INSERT' ? 'recorded' : 'updated'}: ${type} — ${action}`;
    }
    case 'radiographs': {
      const row = e.after ?? e.before;
      if (e.after?.voided_at && !e.before?.voided_at) return `X-ray removed from the record (${e.after.voided_reason})`;
      if (e.action === 'INSERT') {
        const type = RADIOGRAPH_TYPE_LABELS[row?.type as RadiographType] ?? String(row?.type);
        const purpose = RADIOGRAPH_PURPOSE_LABELS[row?.purpose as RadiographPurpose] ?? String(row?.purpose);
        return `X-ray added: ${type}, ${purpose} (teeth ${((row?.teeth as number[] | undefined) ?? []).join(', ')})`;
      }
      const changed = changedFields(e.before, e.after, RADIOGRAPH_FIELD_LABELS);
      return changed.length ? `X-ray updated: ${changed.join(', ')}` : 'X-ray updated';
    }
    // The row holds only the radiograph and implant ids, so the tooth can't be named here.
    case 'radiograph_bone_levels': {
      const mm = (row: Record<string, unknown> | null, side: 'mesial' | 'distal') => {
        const v = row?.[`${side}_mm`];
        return boneLevelLabel(v === null || v === undefined ? null : Number(v));
      };
      const sides = ['mesial', 'distal'] as const;
      if (e.action === 'UPDATE') {
        const changed = sides.filter((s) => mm(e.before, s) !== mm(e.after, s)).map((s) => `${s} ${mm(e.before, s)} → ${mm(e.after, s)}`);
        return changed.length ? `Bone level updated: ${changed.join(', ')}` : 'Bone level updated';
      }
      const row = e.action === 'INSERT' ? e.after : e.before;
      return `Bone level ${e.action === 'INSERT' ? 'recorded' : 'removed'}: ${sides.map((s) => `${s} ${mm(row, s)}`).join(', ')}`;
    }
    default:
      return `${e.table_name} ${e.action.toLowerCase()}`;
  }
}
