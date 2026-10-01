'use client';

import { useActionState } from 'react';
import { updateSettings } from './actions';
import type { ActionState } from '@/lib/admin/schemas';
import type { Settings } from '@/lib/auth/session';

// Inputs deliberately have no min/max so the server-side validation message is what the user sees.
export function SettingsForm({ settings }: { settings: Settings }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateSettings, {});
  return (
    <form action={action} className="card max-w-md space-y-4">
      <label className="block">
        <span className="label">Expiry alert (days)</span>
        <input className="input" name="expiry_alert_days" type="number" defaultValue={settings.expiry_alert_days} />
      </label>
      <label className="block">
        <span className="label">Session timeout (minutes)</span>
        <input className="input" name="session_timeout_minutes" type="number" defaultValue={settings.session_timeout_minutes} />
      </label>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      {state.ok && <p className="text-sm text-green-800">{state.ok}</p>}
      <button className="btn" disabled={pending}>
        Save settings
      </button>
    </form>
  );
}
