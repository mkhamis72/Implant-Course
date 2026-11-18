'use client';

import { useActionState } from 'react';
import { checkedOf, valueOf, type FormState } from '@/lib/patients/form-state';
import { KIND_AVAILABLE, KIND_LABELS, MODULES, MODULE_LABELS, type CompanyKind, type Module } from '@/lib/modules/modules';
import { savePlan } from '../actions';

export type PlanFormPlan = { id: string; name: string; kind: CompanyKind; modules: Module[] };

/** One plan: a new one (no `plan`) or an existing one's editor. The form remounts on each result (React 19 resets
 *  uncontrolled fields), so the saved choices show. */
export function PlanForm({ plan }: { plan?: PlanFormPlan }) {
  const [state, formAction, pending] = useActionState<FormState & { seq?: number }, FormData>(
    async (prev, formData) => ({ ...(await savePlan(prev, formData)), seq: (prev.seq ?? 0) + 1 }),
    {},
  );
  const id = plan?.id ?? 'new';
  return (
    <form key={state.seq ?? 0} action={formAction} className="space-y-3">
      {plan && <input type="hidden" name="id" value={plan.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`plan-name-${id}`}>Name</label>
          <input id={`plan-name-${id}`} name="name" className="input" required defaultValue={valueOf(state, 'name', plan?.name)} />
        </div>
        <div>
          <label className="label" htmlFor={`plan-kind-${id}`}>Type</label>
          {plan ? (
            <>
              <input type="hidden" name="kind" value={plan.kind} />
              <select id={`plan-kind-${id}`} className="input" disabled defaultValue={plan.kind}>
                <option value={plan.kind}>{KIND_LABELS[plan.kind]}</option>
              </select>
            </>
          ) : (
            <select id={`plan-kind-${id}`} name="kind" className="input" defaultValue="course_organizer">
              <option value="course_organizer">{KIND_LABELS.course_organizer}</option>
              <option value="clinic" disabled={!KIND_AVAILABLE.clinic}>{KIND_LABELS.clinic}{KIND_AVAILABLE.clinic ? '' : ' (later release)'}</option>
            </select>
          )}
        </div>
      </div>
      <fieldset>
        <legend className="label">Modules</legend>
        <div className="flex flex-wrap gap-4">
          {MODULES.map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={`module_${m}`} defaultChecked={checkedOf(state, `module_${m}`, plan?.modules.includes(m) ?? false)} /> {MODULE_LABELS[m]}
            </label>
          ))}
        </div>
      </fieldset>
      <button className="btn" disabled={pending}>{plan ? 'Save' : 'Add plan'}</button>
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm text-ok">{state.ok}</p>}
    </form>
  );
}
