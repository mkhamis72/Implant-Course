'use client';

import { useActionState } from 'react';
import { savePassportSettings } from './actions';
import type { ActionState } from '@/lib/admin/schemas';
import { MEDICAL_LEVELS, MEDICAL_LEVEL_LABELS, type MedicalLevel } from '@/lib/passport/labels';

/** The medical content new passports print; stored copies keep the level they were made with. */
export function PassportSettingsForm({ medical }: { medical: MedicalLevel }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(savePassportSettings, {});
  return (
    <form action={action} className="card max-w-md space-y-4">
      {/* React 19 resets the form after the action: remount the radios on each result so they show what was saved. */}
      <fieldset key={JSON.stringify(state)} role="radiogroup" aria-labelledby="passport-medical-legend" className="space-y-2">
        <legend id="passport-medical-legend" className="label">Medical content</legend>
        {MEDICAL_LEVELS.map((level) => (
          <label key={level} className="flex items-center gap-2 text-sm">
            <input type="radio" name="medical" value={level} defaultChecked={level === medical} />
            {MEDICAL_LEVEL_LABELS[level]}
          </label>
        ))}
      </fieldset>
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      {state.ok && <p className="text-sm text-ok">{state.ok}</p>}
      <button className="btn" disabled={pending}>
        Save passport settings
      </button>
    </form>
  );
}
