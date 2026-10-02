'use client';

import { useActionState } from 'react';
import { setUserActive, setUserRole } from './actions';
import type { ActionState } from '@/lib/admin/schemas';
import type { Profile } from '@/lib/auth/session';

export function UserRow({ user, isSelf }: { user: Profile; isSelf: boolean }) {
  const [roleState, roleAction, rolePending] = useActionState<ActionState, FormData>(setUserRole, {});
  const [activeState, activeAction, activePending] = useActionState<ActionState, FormData>(setUserActive, {});
  const message = roleState.error ?? activeState.error ?? roleState.ok ?? activeState.ok;
  const isError = Boolean(roleState.error ?? activeState.error);

  return (
    <tr data-testid={`user-row-${user.email}`} className="border-t border-line align-top">
      <td className="py-2 pr-4">
        {user.full_name || '—'} {isSelf && <span className="text-muted">(you)</span>}
      </td>
      <td className="py-2 pr-4">{user.email}</td>
      <td className="py-2 pr-4">
        {isSelf ? (
          <span className="capitalize">{user.role}</span>
        ) : (
          <form action={roleAction} className="flex gap-2">
            <input type="hidden" name="user_id" value={user.user_id} />
            <select className="input py-1" name="role" defaultValue={user.role} aria-label="Role">
              <option value="organizer">Organizer</option>
              <option value="admin">Admin</option>
            </select>
            <button className="btn-secondary btn py-1" disabled={rolePending}>
              Change role
            </button>
          </form>
        )}
      </td>
      <td className="py-2 pr-4">{user.active ? 'Active' : 'Inactive'}</td>
      <td className="py-2">
        {!isSelf && (
          <form action={activeAction}>
            <input type="hidden" name="user_id" value={user.user_id} />
            <input type="hidden" name="active" value={user.active ? 'false' : 'true'} />
            <button className="btn-secondary btn py-1" disabled={activePending}>
              {user.active ? 'Deactivate' : 'Reactivate'}
            </button>
          </form>
        )}
        {message && (
          <p role={isError ? 'alert' : undefined} className={`mt-1 text-sm ${isError ? 'text-bad' : 'text-ok'}`}>
            {message}
          </p>
        )}
      </td>
    </tr>
  );
}
