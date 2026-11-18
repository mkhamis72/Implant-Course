import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UserRow, type Account } from './user-row';
import type { UserListRow } from './page';

vi.mock('./actions', () => ({
  removeUser: vi.fn(), resendInvite: vi.fn(), setUserActive: vi.fn(), setUserRole: vi.fn(), resetPassword: vi.fn(),
  changeEmail: vi.fn(), resetTwoFactor: vi.fn(), resetGoogle: vi.fn(), editName: vi.fn(), savePermissions: vi.fn(),
}));

const user: UserListRow = {
  user_id: '1b4e28ba-2fa1-41d2-883f-0016d3cca427', full_name: 'Dr Org', email: 'org@example.com', role: 'organizer',
  active: true, delegate_id: null, mfa_setup_required: false, permissions: {},
};
const account = (over: Partial<Account> = {}): Account => ({ lastSignIn: '2026-10-23T08:05:00Z', hasFactor: true, hasGoogle: false, invitePending: false, history: [], ...over });

function renderRow(props: { isSelf?: boolean; account?: Account; emailOn?: boolean } = {}) {
  return render(
    <table><tbody>
      <UserRow user={user} isSelf={props.isSelf ?? false} account={props.account ?? account()} emailOn={props.emailOn ?? true} features={['inventory', 'statistics', 'teaching']} />
    </tbody></table>,
  );
}

describe('UserRow, Google', () => {
  it('user_row_shows_google_badge', () => {
    renderRow({ account: account({ hasGoogle: true }) });
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset Google sign-in for org@example.com' })).toBeInTheDocument();
  });
  it('shows no badge or reset when Google is not used', () => {
    renderRow();
    expect(screen.queryByText('Google')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reset Google/ })).not.toBeInTheDocument();
  });
});

describe('UserRow', () => {
  it('offers Edit name, Change email and Reset 2FA on another user with a factor', () => {
    renderRow();
    expect(screen.getByRole('button', { name: 'Edit name of Dr Org' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change email of org@example.com' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset 2FA for org@example.com' })).toBeInTheDocument();
    expect(screen.getByText('Last sign-in: 23 Oct 2026, 11:05')).toBeInTheDocument();
  });

  it('hides Change email and Reset 2FA on your own row, but keeps Edit name', () => {
    renderRow({ isSelf: true });
    expect(screen.getByRole('button', { name: 'Edit name of Dr Org' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Change email/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reset 2FA/ })).not.toBeInTheDocument();
  });

  it('hides Reset 2FA without a factor', () => {
    renderRow({ account: account({ hasFactor: false }) });
    expect(screen.queryByRole('button', { name: /Reset 2FA/ })).not.toBeInTheDocument();
  });

  it('offers Reset 2FA again, with a pending badge, while the user must still set it up', () => {
    render(
      <table><tbody>
        <UserRow user={{ ...user, mfa_setup_required: true }} isSelf={false} account={account({ hasFactor: false })} emailOn features={['statistics']} />
      </tbody></table>,
    );
    expect(screen.getByText('2FA set-up pending')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset 2FA for org@example.com' })).toBeInTheDocument();
  });

  it('shows Resend invite only for a user who has no password yet, with email on', () => {
    renderRow({ account: account({ lastSignIn: null, invitePending: true }) });
    expect(screen.getByRole('button', { name: 'Resend invite to org@example.com' })).toBeInTheDocument();
    expect(screen.getByText('Last sign-in: Never')).toBeInTheDocument();
  });

  it('hides Resend invite once they have a password, or with email off', () => {
    const { unmount } = renderRow();
    expect(screen.queryByRole('button', { name: /Resend invite/ })).not.toBeInTheDocument();
    unmount();
    renderRow({ account: account({ lastSignIn: null, invitePending: true }), emailOn: false });
    expect(screen.queryByRole('button', { name: /Resend invite/ })).not.toBeInTheDocument();
  });

  it('lists the history labels', () => {
    renderRow({ account: account({ history: [{ at: '2026-10-23T08:00:00Z', actor_name: 'Dr Admin', kind: 'email_changed' }] }) });
    expect(screen.getByText('History')).toBeInTheDocument();
    expect(screen.getByText('Email changed by Dr Admin · 23 Oct 2026')).toBeInTheDocument();
  });
});

describe('UserRow in a clinic', () => {
  it('offers no Delegate role', () => {
    render(
      <table><tbody>
        <UserRow user={user} isSelf={false} account={account()} emailOn features={['inventory']} />
      </tbody></table>,
    );
    expect(screen.queryByRole('option', { name: 'Delegate' })).not.toBeInTheDocument();
  });
});
