'use client';

import { useActionState } from 'react';
import { AREAS, AREA_LABELS, VIEW_ONLY_AREAS, type Permissions } from '@/lib/auth/permissions';
import type { ActionState } from '@/lib/admin/schemas';
import { savePermissions } from './actions';

const LEVELS = [
  { value: 'none', label: 'None' },
  { value: 'view', label: 'View' },
  { value: 'edit', label: 'Edit' },
] as const;

/** None / View / Edit per panel for one organizer; view-only areas (Research) have no Edit. */
export function PermissionGrid({ userId, permissions }: { userId: string; permissions: Permissions }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(savePermissions, {});
  return (
    <form action={action} className="mt-2 space-y-2">
      <input type="hidden" name="user_id" value={userId} />
      {/* Remount on new saved values: React resets the form after the action, which would show the old choices. */}
      <div key={JSON.stringify(permissions)} className="space-y-1">
        {AREAS.map((area) => (
          <fieldset key={area} className="flex flex-wrap items-center gap-x-3 text-sm">
            <legend className="float-left w-24 font-medium">{AREA_LABELS[area]}</legend>
            {LEVELS.filter((l) => l.value !== 'edit' || !VIEW_ONLY_AREAS.includes(area)).map((l) => (
              <label key={l.value} className="flex items-center gap-1">
                <input type="radio" name={`perm_${area}`} value={l.value} defaultChecked={(permissions[area] ?? 'none') === l.value} />
                {l.label}
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <button className="btn-secondary btn py-1" disabled={pending}>
        Save permissions
      </button>
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      {state.ok && <p className="text-sm text-ok">{state.ok}</p>}
    </form>
  );
}
