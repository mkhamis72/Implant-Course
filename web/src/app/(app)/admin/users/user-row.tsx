'use client';

import { useActionState } from 'react';
import { removeUser, resendInvite, setUserActive, setUserRole } from './actions';
import { ConfirmDelete } from '@/components/confirm-delete';
import { ResetPassword } from './reset-password';
import type { ActionState } from '@/lib/admin/schemas';
import type { Profile } from '@/lib/auth/session';
import { PermissionGrid } from './permission-grid';
import { EditName } from './edit-name';
import { ChangeEmail } from './change-email';
import { ResetTwoFactor } from './reset-two-factor';
import { UserHistory } from './user-history';
import type { HistoryEntry } from '@/lib/admin/history';
import { formatDateTime } from '@/lib/format';

const ROLE_LABELS = { admin: 'Admin', organizer: 'Organizer', delegate: 'Delegate' } as const;

/** What the page learns about the login from Auth, plus the admin history. */
export type Account = {
  /** ISO time; null = never signed in; undefined = Auth couldn't say. */
  lastSignIn: string | null | undefined;
  /** Has a verified 2FA factor (Reset 2FA is offered only then). */
  hasFactor: boolean;
  history: HistoryEntry[];
};

function lastSignInText(lastSignIn: Account['lastSignIn']): string {
  if (lastSignIn === undefined) return 'unknown';
  return lastSignIn === null ? 'Never' : formatDateTime(lastSignIn);
}

export function UserRow({ user, isSelf, account, emailOn }: { user: Profile; isSelf: boolean; account: Account; emailOn: boolean }) {
  const [roleState, roleAction, rolePending] = useActionState<ActionState, FormData>(setUserRole, {});
  const [activeState, activeAction, activePending] = useActionState<ActionState, FormData>(setUserActive, {});
  const [inviteState, inviteAction, invitePending] = useActionState<ActionState, FormData>(resendInvite, {});
  const message = roleState.error ?? activeState.error ?? inviteState.error ?? roleState.ok ?? activeState.ok ?? inviteState.ok;
  const isError = Boolean(roleState.error ?? activeState.error ?? inviteState.error);

  return (
    <tr data-testid={`user-row-${user.email}`} className="border-t border-line align-top">
      <td data-label="Name" className="py-2 pr-4">
        <EditName userId={user.user_id} name={user.full_name} isSelf={isSelf} />
      </td>
      <td data-label="Email" className="py-2 pr-4">
        <div>{user.email}</div>
        {!isSelf && <ChangeEmail userId={user.user_id} email={user.email} />}
      </td>
      <td data-label="Role" className="py-2 pr-4">
        {isSelf || user.role === 'delegate' ? (
          <span>{ROLE_LABELS[user.role]}</span>
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
      <td data-label="Status" className="py-2 pr-4">
        <div>{user.active ? 'Active' : 'Inactive'}</div>
        <div className="text-sm text-muted">Last sign-in: {lastSignInText(account.lastSignIn)}</div>
        {user.mfa_setup_required && <span className="badge badge-warn">2FA set-up pending</span>}
      </td>
      <td data-label="Actions" className="py-2">
        {!isSelf && (
          <form action={activeAction}>
            <input type="hidden" name="user_id" value={user.user_id} />
            <input type="hidden" name="active" value={user.active ? 'false' : 'true'} />
            <button className="btn-secondary btn py-1" disabled={activePending}>
              {user.active ? 'Deactivate' : 'Reactivate'}
            </button>
          </form>
        )}
        {!isSelf && (
          <div className="mt-2 space-y-2">
            <ResetPassword userId={user.user_id} label={`Reset password for ${user.email}`} />
            {/* While set-up is still required, a reset that half-failed can be retried. */}
            <ResetTwoFactor userId={user.user_id} email={user.email} available={account.hasFactor || user.mfa_setup_required} />
            {account.lastSignIn === null && emailOn && (
              <form action={inviteAction}>
                <input type="hidden" name="user_id" value={user.user_id} />
                <button className="btn-secondary btn py-1" disabled={invitePending} aria-label={`Resend invite to ${user.email}`}>
                  Resend invite
                </button>
              </form>
            )}
            <ConfirmDelete
              id={user.user_id}
              noun="user"
              name={user.full_name || user.email}
              consequences="Their login is deleted. Someone who has records in the app (implants, stock, notes, checklist work) can't be deleted — deactivate them instead."
              action={removeUser}
              triggerLabel={`Delete user ${user.email}`}
            />
          </div>
        )}
        {user.role === 'organizer' && !isSelf && (
          <details className="mt-2">
            <summary className="cursor-pointer text-sm text-accent">Permissions</summary>
            <PermissionGrid userId={user.user_id} permissions={user.permissions} />
          </details>
        )}
        <UserHistory entries={account.history} />
        {message && (
          <p role={isError ? 'alert' : undefined} className={`mt-1 text-sm ${isError ? 'text-bad' : 'text-ok'}`}>
            {message}
          </p>
        )}
      </td>
    </tr>
  );
}
