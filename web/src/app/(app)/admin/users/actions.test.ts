import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { createLogin, rpc, deleteAuthUser, setTemporaryPassword, changeAuthEmail, resetAuthFactors, inviteLink, sendEmail, hasVerifiedFactor } = vi.hoisted(() => ({
  createLogin: vi.fn(), rpc: vi.fn(), deleteAuthUser: vi.fn(), setTemporaryPassword: vi.fn(),
  changeAuthEmail: vi.fn(), resetAuthFactors: vi.fn(), inviteLink: vi.fn(), sendEmail: vi.fn(), hasVerifiedFactor: vi.fn(),
}));
const { memberOfMyCompany, sharedWithAnotherCompany, activeInAnotherCompany, profileRemains } = vi.hoisted(() => ({
  memberOfMyCompany: vi.fn(), sharedWithAnotherCompany: vi.fn(), activeInAnotherCompany: vi.fn(), profileRemains: vi.fn(),
}));
const { SHARED } = vi.hoisted(() => ({ SHARED: 'This user also belongs to another company. Ask support to change their sign-in details.' }));
vi.mock('@/lib/admin/same-company', () => ({
  memberOfMyCompany, sharedWithAnotherCompany, activeInAnotherCompany, profileRemains,
  USER_NOT_FOUND: 'User not found.', SHARED_USER: SHARED,
}));
vi.mock('@/lib/tenant/current', () => ({ currentTenant: vi.fn(async () => ({ slug: 'academy', companyId: 'a7c0de00-0000-4000-8000-000000000001' })) }));
const { ME } = vi.hoisted(() => ({ ME: '9c1d6e2a-3b4f-4a5e-8d7c-1f2e3d4c5b6a' }));
vi.mock('@/lib/auth/session', () => ({ requireAdmin: vi.fn(async () => ({ user_id: ME })) }));
vi.mock('@/lib/admin/create-login', () => ({ createLogin }));
vi.mock('@/lib/admin/auth-accounts', () => ({ deleteAuthUser, setTemporaryPassword, changeAuthEmail, resetAuthFactors, inviteLink, hasVerifiedFactor }));
vi.mock('@/lib/email/send', () => ({ sendEmail }));
vi.mock('@/lib/branding/get', () => ({ getBranding: vi.fn(async () => ({ name: 'Academy' })) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
const { flagged } = vi.hoisted(() => ({ flagged: { value: false } }));
const { fromTable, eqs } = vi.hoisted(() => ({ fromTable: vi.fn(), eqs: vi.fn() }));
const memberQuery: { select: () => unknown; eq: (c: string, v: unknown) => unknown; maybeSingle: () => Promise<unknown> } = {
  select: () => memberQuery,
  eq: (c, v) => (eqs(c, v), memberQuery),
  maybeSingle: async () => ({ data: { mfa_setup_required: flagged.value }, error: null }),
};
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ rpc, from: (t: string) => (fromTable(t), memberQuery) })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { changeEmail, editName, inviteUser, removeUser, resendInvite, resetPassword, resetTwoFactor, savePermissions, setUserActive, setUserRole } from './actions';
import { createAdminClient } from '@/lib/supabase/admin';

beforeEach(() => {
  vi.clearAllMocks();
  flagged.value = false;
  memberOfMyCompany.mockResolvedValue(true);
  sharedWithAnotherCompany.mockResolvedValue(false);
  activeInAnotherCompany.mockResolvedValue(false);
  profileRemains.mockResolvedValue(false);
});

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe('inviteUser', () => {
  it('creates the login and passes back a one-time password when there is one', async () => {
    createLogin.mockResolvedValue({ ok: 'Login created for new@example.com.', password: 'Temp-Pass-123' });
    const r = await inviteUser({}, form({ email: 'New@Example.com', full_name: 'Dr New', role: 'organizer' }));
    expect(createLogin).toHaveBeenCalledWith({ email: 'new@example.com', full_name: 'Dr New', role: 'organizer' });
    expect(r).toEqual({ ok: 'Login created for new@example.com.', password: 'Temp-Pass-123' });
  });
  it('validates before creating anything', async () => {
    expect(await inviteUser({}, form({ email: 'nope', full_name: 'Dr New', role: 'organizer' }))).toHaveProperty('error');
    expect(createLogin).not.toHaveBeenCalled();
  });
});

describe('savePermissions', () => {
  const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
  const grid = { user_id: id, perm_patients: 'edit', perm_schedule: 'view', perm_courses: 'none', perm_checklists: 'none', perm_inventory: 'view', perm_delegates: 'none', perm_research: 'view' };
  it('saves the grid through set_user_permissions', async () => {
    rpc.mockResolvedValue({ error: null });
    expect(await savePermissions({}, form(grid))).toEqual({ ok: 'Permissions saved.' });
    expect(rpc).toHaveBeenCalledWith('set_user_permissions', {
      p_user: id,
      p_perms: { patients: 'edit', schedule: 'view', courses: null, checklists: null, inventory: 'view', delegates: null, research: 'view' },
    });
  });
  it('shows the database’s refusal', async () => {
    rpc.mockResolvedValue({ error: { message: 'You cannot change your own permissions.', hint: 'user' } });
    expect(await savePermissions({}, form(grid))).toEqual({ error: 'You cannot change your own permissions.' });
  });
});

describe('removeUser', () => {
  const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
  it('removes the profile through delete_user, then the sign-in account', async () => {
    rpc.mockResolvedValue({ error: null });
    deleteAuthUser.mockResolvedValue(null);
    expect(await removeUser({}, form({ id }))).toEqual({ ok: 'User removed.' });
    expect(rpc).toHaveBeenCalledWith('delete_user', { p_user: id });
    expect(deleteAuthUser).toHaveBeenCalledWith(id);
  });
  it('keeps the sign-in account while another company still has the profile', async () => {
    rpc.mockResolvedValue({ error: null });
    profileRemains.mockResolvedValue(true);
    expect(await removeUser({}, form({ id }))).toEqual({ ok: 'User removed.' });
    expect(rpc).toHaveBeenCalledWith('delete_user', { p_user: id });
    expect(profileRemains).toHaveBeenCalledWith(id);
    expect(deleteAuthUser).not.toHaveBeenCalled();
  });
  it('keeps the sign-in account, and says so, when it cannot tell whether the profile is gone', async () => {
    rpc.mockResolvedValue({ error: null });
    profileRemains.mockResolvedValue(null);
    expect(await removeUser({}, form({ id }))).toEqual({
      error: "The user was removed from this company, but it couldn't be checked whether their sign-in account can be deleted.",
    });
    expect(deleteAuthUser).not.toHaveBeenCalled();
  });
  it('keeps the account when the database refuses (e.g. the user has records)', async () => {
    rpc.mockResolvedValue({ error: { message: 'Dr X has records in the app … Deactivate them instead.', hint: 'user' } });
    expect(await removeUser({}, form({ id }))).toEqual({ error: 'Dr X has records in the app … Deactivate them instead.' });
    expect(deleteAuthUser).not.toHaveBeenCalled();
  });
  it('says so when the sign-in account could not be deleted', async () => {
    rpc.mockResolvedValue({ error: null });
    deleteAuthUser.mockResolvedValue('Something went wrong.');
    expect(await removeUser({}, form({ id }))).toHaveProperty('error');
  });
  it('rejects a malformed id before touching anything', async () => {
    expect(await removeUser({}, form({ id: 'nope' }))).toHaveProperty('error');
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('resetPassword', () => {
  const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
  it('sets and passes back a new one-time password', async () => {
    setTemporaryPassword.mockResolvedValue({ password: 'New-Temp-1' });
    expect(await resetPassword({}, form({ user_id: id }))).toEqual({ ok: 'New one-time password set.', password: 'New-Temp-1' });
    expect(setTemporaryPassword).toHaveBeenCalledWith(id);
  });
  it('is not for your own account', async () => {
    expect(await resetPassword({}, form({ user_id: ME }))).toHaveProperty('error');
    expect(setTemporaryPassword).not.toHaveBeenCalled();
  });
});

const SELF = "You can't do this to your own account here. Use Account → Security.";
/** rpc answers by function name; anything unnamed succeeds. */
const rpcAnswers = (answers: Record<string, { message: string; hint?: string }>) =>
  rpc.mockImplementation(async (name: string) => ({ error: answers[name] ?? null }));

describe('changeEmail', () => {
  const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
  const fields = { user_id: id, email: ' New@Example.com ' };

  it('changes Auth, then the app record, then ends sessions, then sends the notices', async () => {
    changeAuthEmail.mockResolvedValue({ previous: { email: 'old@example.com', signedInBefore: true } });
    rpcAnswers({});
    sendEmail.mockResolvedValue('sent');
    expect(await changeEmail({}, form(fields))).toEqual({ ok: 'Email changed to new@example.com.' });
    expect(changeAuthEmail).toHaveBeenCalledWith(id, 'new@example.com');
    expect(rpc.mock.calls).toEqual([
      ['admin_change_email', { p_user: id, p_email: 'new@example.com' }],
      ['admin_end_sessions', { p_user: id }],
    ]);
    expect(changeAuthEmail.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[0]);
    expect(rpc.mock.invocationCallOrder[1]).toBeLessThan(sendEmail.mock.invocationCallOrder[0]);
    expect(sendEmail.mock.calls.map((c) => c[0].to)).toEqual(['new@example.com', 'old@example.com']);
    expect(sendEmail.mock.calls[0][0].subject).toBe('Your sign-in email was changed');
  });

  it('skips the old-address notice when the user never signed in', async () => {
    changeAuthEmail.mockResolvedValue({ previous: { email: 'typo@example.com', signedInBefore: false } });
    rpcAnswers({});
    sendEmail.mockResolvedValue('sent');
    await changeEmail({}, form(fields));
    expect(sendEmail.mock.calls.map((c) => c[0].to)).toEqual(['new@example.com']);
  });

  it('puts the old address back in Auth when the database refuses', async () => {
    changeAuthEmail
      .mockResolvedValueOnce({ previous: { email: 'old@example.com', signedInBefore: true } })
      .mockResolvedValueOnce({ previous: { email: 'new@example.com', signedInBefore: true } });
    rpcAnswers({ admin_change_email: { message: 'Another account already uses that email.', hint: 'user' } });
    expect(await changeEmail({}, form(fields))).toEqual({ error: 'Another account already uses that email.' });
    expect(changeAuthEmail).toHaveBeenNthCalledWith(2, id, 'old@example.com');
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(['admin_change_email']);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('says exactly what is half-done, and records it, when putting it back fails too', async () => {
    changeAuthEmail
      .mockResolvedValueOnce({ previous: { email: 'old@example.com', signedInBefore: true } })
      .mockResolvedValueOnce({ error: 'Something went wrong. Please try again.' });
    rpcAnswers({ admin_change_email: { message: 'boom' } });
    expect(await changeEmail({}, form(fields))).toEqual({
      error: `The sign-in email was changed to new@example.com but the app record wasn't. Ask your developer to fix user ${id}.`,
    });
    expect(rpc).toHaveBeenCalledWith('admin_record_event', { p_user: id, p_kind: 'email_change_incomplete' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('refuses your own account before touching anything, whatever the case of the id', async () => {
    expect(await changeEmail({}, form({ user_id: ME.toUpperCase(), email: 'new@example.com' }))).toEqual({ error: SELF });
    expect(changeAuthEmail).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('validates the address before touching anything', async () => {
    expect(await changeEmail({}, form({ user_id: id, email: 'nope' }))).toEqual({ error: 'Enter a valid email address.' });
    expect(changeAuthEmail).not.toHaveBeenCalled();
  });

  it('stops at an Auth refusal', async () => {
    changeAuthEmail.mockResolvedValue({ error: 'Another account already uses that email.' });
    expect(await changeEmail({}, form(fields))).toEqual({ error: 'Another account already uses that email.' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('says when sessions could not be ended, and still sends the notices', async () => {
    changeAuthEmail.mockResolvedValue({ previous: { email: 'old@example.com', signedInBefore: false } });
    rpcAnswers({ admin_end_sessions: { message: 'permission denied for table sessions' } });
    sendEmail.mockResolvedValue('sent');
    expect(await changeEmail({}, form(fields))).toEqual({
      error: 'Changed, but existing sessions could not be ended: permission denied for table sessions',
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('only warns when a notice fails', async () => {
    changeAuthEmail.mockResolvedValue({ previous: { email: 'old@example.com', signedInBefore: true } });
    rpcAnswers({});
    sendEmail.mockResolvedValueOnce('sent').mockResolvedValueOnce('failed');
    expect(await changeEmail({}, form(fields))).toEqual({
      ok: "Email changed to new@example.com. The notice to old@example.com couldn't be sent.",
    });
  });
});

describe('resetTwoFactor', () => {
  const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
  it('requires set-up first, then deletes every factor, then ends sessions', async () => {
    hasVerifiedFactor.mockResolvedValue(true);
    resetAuthFactors.mockResolvedValue(null);
    rpcAnswers({});
    expect(await resetTwoFactor({}, form({ user_id: id }))).toEqual({
      ok: 'Two-factor authentication reset. They must set it up again when they next sign in.',
    });
    expect(resetAuthFactors).toHaveBeenCalledWith(id);
    expect(rpc.mock.calls).toEqual([
      ['admin_require_mfa_setup', { p_user: id }],
      ['admin_end_sessions', { p_user: id }],
    ]);
    const [flag, sessions] = rpc.mock.invocationCallOrder;
    const factors = resetAuthFactors.mock.invocationCallOrder[0];
    expect(flag).toBeLessThan(factors);
    expect(factors).toBeLessThan(sessions);
  });
  it('refuses a user without a verified factor before setting anything', async () => {
    hasVerifiedFactor.mockResolvedValue(false);
    expect(await resetTwoFactor({}, form({ user_id: id }))).toEqual({ error: 'This user has no two-factor authentication to reset.' });
    expect(rpc).not.toHaveBeenCalled();
    expect(resetAuthFactors).not.toHaveBeenCalled();
  });
  it('says so when Auth cannot tell whether there is a factor', async () => {
    hasVerifiedFactor.mockResolvedValue(null);
    expect(await resetTwoFactor({}, form({ user_id: id }))).toEqual({ error: "Couldn't check this user's two-factor authentication. Try again." });
    expect(rpc).not.toHaveBeenCalled();
  });
  it('touches no factor when the flag could not be set', async () => {
    hasVerifiedFactor.mockResolvedValue(true);
    rpcAnswers({ admin_require_mfa_setup: { message: 'Only an admin can do this.', hint: 'user' } });
    expect(await resetTwoFactor({}, form({ user_id: id }))).toEqual({ error: 'Only an admin can do this.' });
    expect(resetAuthFactors).not.toHaveBeenCalled();
  });
  it('still ends sessions when the factors could not be deleted', async () => {
    hasVerifiedFactor.mockResolvedValue(true);
    resetAuthFactors.mockResolvedValue('Something went wrong. Please try again.');
    rpcAnswers({});
    expect(await resetTwoFactor({}, form({ user_id: id }))).toEqual({
      error: "Setting up two-factor authentication again is now required, but the old authenticator couldn't be removed: Something went wrong. Please try again. Try Reset 2FA again.",
    });
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(['admin_require_mfa_setup', 'admin_end_sessions']);
  });
  it('reports both problems when factors and sessions both fail', async () => {
    hasVerifiedFactor.mockResolvedValue(true);
    resetAuthFactors.mockResolvedValue('Boom.');
    rpcAnswers({ admin_end_sessions: { message: 'nope' } });
    expect(await resetTwoFactor({}, form({ user_id: id }))).toEqual({
      error: "Setting up two-factor authentication again is now required, but the old authenticator couldn't be removed: Boom. Try Reset 2FA again. Existing sessions could not be ended either: nope",
    });
  });
  it('retries for a user still required to set up 2FA, even with no verified factor left, and ends sessions', async () => {
    hasVerifiedFactor.mockResolvedValue(false);
    flagged.value = true;
    resetAuthFactors.mockResolvedValue(null);
    rpcAnswers({});
    expect(await resetTwoFactor({}, form({ user_id: id }))).toEqual({
      ok: 'Two-factor authentication reset. They must set it up again when they next sign in.',
    });
    expect(resetAuthFactors).toHaveBeenCalledWith(id);
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(['admin_require_mfa_setup', 'admin_end_sessions']);
    expect(fromTable).toHaveBeenCalledWith('company_members');
    expect(eqs.mock.calls).toEqual([['company_id', 'a7c0de00-0000-4000-8000-000000000001'], ['user_id', id]]);
  });
  it('says when sessions could not be ended', async () => {
    hasVerifiedFactor.mockResolvedValue(true);
    resetAuthFactors.mockResolvedValue(null);
    rpcAnswers({ admin_end_sessions: { message: 'nope' } });
    expect(await resetTwoFactor({}, form({ user_id: id }))).toEqual({ error: 'Changed, but existing sessions could not be ended: nope' });
  });
  it('refuses your own account, whatever the case of the id', async () => {
    expect(await resetTwoFactor({}, form({ user_id: ME.toUpperCase() }))).toEqual({ error: SELF });
    expect(resetAuthFactors).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('editName', () => {
  const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
  it('saves the trimmed name through admin_set_name', async () => {
    rpcAnswers({});
    expect(await editName({}, form({ user_id: id, full_name: '  Dr New  ' }))).toEqual({ ok: 'Name saved.' });
    expect(rpc).toHaveBeenCalledWith('admin_set_name', { p_user: id, p_name: 'Dr New' });
  });
  it('refuses an empty or over-long name', async () => {
    expect(await editName({}, form({ user_id: id, full_name: '   ' }))).toEqual({ error: 'Enter a name.' });
    expect(await editName({}, form({ user_id: id, full_name: 'x'.repeat(121) }))).toEqual({ error: 'Keep the name to 120 characters or fewer.' });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('resendInvite', () => {
  const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
  it('sends the invite and records it', async () => {
    inviteLink.mockResolvedValue({ email: 'new@example.com', link: 'https://academy.example.com/auth/confirm?token_hash=h&type=invite' });
    sendEmail.mockResolvedValue('sent');
    rpcAnswers({});
    expect(await resendInvite({}, form({ user_id: id }))).toEqual({ ok: 'Invitation sent again to new@example.com.' });
    expect(inviteLink).toHaveBeenCalledWith(id);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'new@example.com', subject: "You're invited to Academy" }));
    expect(rpc).toHaveBeenCalledWith('admin_record_event', { p_user: id, p_kind: 'invite_resent' });
  });
  it('records nothing when the email could not be sent', async () => {
    inviteLink.mockResolvedValue({ email: 'new@example.com', link: 'https://x/auth/confirm' });
    sendEmail.mockResolvedValue('failed');
    expect(await resendInvite({}, form({ user_id: id }))).toEqual({ error: "The invite couldn't be sent. Try again, or use Reset password." });
    expect(rpc).not.toHaveBeenCalled();
  });
  it('is off while email is off', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'false');
    try {
      expect(await resendInvite({}, form({ user_id: id }))).toHaveProperty('error');
      expect(inviteLink).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('company check before any Auth change', () => {
  const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
  const cases: [string, (f: FormData) => Promise<unknown>, Record<string, string>][] = [
    ['resetPassword', (f) => resetPassword({}, f), { user_id: id }],
    ['changeEmail', (f) => changeEmail({}, f), { user_id: id, email: 'new@example.com' }],
    ['resetTwoFactor', (f) => resetTwoFactor({}, f), { user_id: id }],
    ['editName', (f) => editName({}, f), { user_id: id, full_name: 'New Name' }],
    ['resendInvite', (f) => resendInvite({}, f), { user_id: id }],
    ['removeUser', (f) => removeUser({}, f), { id }],
    ['setUserActive', (f) => setUserActive({}, f), { user_id: id, active: 'false' }],
    ['setUserRole', (f) => setUserRole({}, f), { user_id: id, role: 'admin' }],
  ];
  afterEach(() => vi.unstubAllEnvs());
  it.each(cases)('%s refuses a user outside the company, without touching Auth', async (_name, run, fields) => {
    vi.stubEnv('EMAIL_ENABLED', 'true');
    memberOfMyCompany.mockResolvedValue(false);
    expect(await run(form(fields))).toEqual({ error: 'User not found.' });
    expect(memberOfMyCompany).toHaveBeenCalledWith(id);
    expect(createAdminClient).not.toHaveBeenCalled();
    for (const fn of [deleteAuthUser, setTemporaryPassword, changeAuthEmail, resetAuthFactors, inviteLink, hasVerifiedFactor, sendEmail, rpc]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
  it('resetPassword goes ahead for a member', async () => {
    setTemporaryPassword.mockResolvedValue({ password: 'Temp-Pass-123' });
    expect(await resetPassword({}, form({ user_id: id }))).toMatchObject({ ok: 'New one-time password set.' });
    expect(setTemporaryPassword).toHaveBeenCalledTimes(1);
  });
});

describe('setUserRole', () => {
  const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
  it("changes the role of this company's member through set_member_role", async () => {
    rpcAnswers({});
    expect(await setUserRole({}, form({ user_id: id, role: 'admin' }))).toEqual({ ok: 'Role updated.' });
    expect(memberOfMyCompany).toHaveBeenCalledWith(id);
    expect(rpc).toHaveBeenCalledWith('set_member_role', { p_user: id, p_role: 'admin' });
  });
  it('refuses a user outside the company before changing anything', async () => {
    memberOfMyCompany.mockResolvedValue(false);
    expect(await setUserRole({}, form({ user_id: id, role: 'admin' }))).toEqual({ error: 'User not found.' });
    expect(rpc).not.toHaveBeenCalled();
  });
  it('shows the database’s refusal', async () => {
    rpcAnswers({ set_member_role: { message: 'Choose admin or organizer for a staff login.', hint: 'user' } });
    expect(await setUserRole({}, form({ user_id: id, role: 'organizer' }))).toEqual({ error: 'Choose admin or organizer for a staff login.' });
  });
});

describe('setUserActive', () => {
  const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
  const updateUserById = vi.fn();
  beforeEach(() => {
    updateUserById.mockReset().mockResolvedValue({ error: null });
    vi.mocked(createAdminClient).mockResolvedValue({ auth: { admin: { updateUserById } } } as never);
  });
  it('deactivates the membership through set_member_active, then bans the sign-in', async () => {
    rpcAnswers({});
    expect(await setUserActive({}, form({ user_id: id, active: 'false' }))).toEqual({ ok: 'User deactivated.' });
    expect(rpc).toHaveBeenCalledWith('set_member_active', { p_user: id, p_active: false });
    expect(activeInAnotherCompany).toHaveBeenCalledWith(id);
    expect(updateUserById).toHaveBeenCalledWith(id, { ban_duration: '876000h' });
  });
  it('bans no sign-in while another company still has the user active', async () => {
    rpcAnswers({});
    activeInAnotherCompany.mockResolvedValue(true);
    expect(await setUserActive({}, form({ user_id: id, active: 'false' }))).toEqual({ ok: 'User deactivated.' });
    expect(rpc).toHaveBeenCalledWith('set_member_active', { p_user: id, p_active: false });
    expect(updateUserById).not.toHaveBeenCalled();
  });
  it('reactivates and lifts the ban', async () => {
    rpcAnswers({});
    expect(await setUserActive({}, form({ user_id: id, active: 'true' }))).toEqual({ ok: 'User reactivated.' });
    expect(rpc).toHaveBeenCalledWith('set_member_active', { p_user: id, p_active: true });
    expect(updateUserById).toHaveBeenCalledWith(id, { ban_duration: 'none' });
  });
  it('touches no ban when the database refuses', async () => {
    rpcAnswers({ set_member_active: { message: 'User not found.', hint: 'user' } });
    expect(await setUserActive({}, form({ user_id: id, active: 'false' }))).toEqual({ error: 'User not found.' });
    expect(updateUserById).not.toHaveBeenCalled();
  });
});

describe('users shared with another company', () => {
  const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
  const cases: [string, (f: FormData) => Promise<unknown>, Record<string, string>][] = [
    ['resetPassword', (f) => resetPassword({}, f), { user_id: id }],
    ['changeEmail', (f) => changeEmail({}, f), { user_id: id, email: 'new@example.com' }],
    ['resetTwoFactor', (f) => resetTwoFactor({}, f), { user_id: id }],
  ];
  it.each(cases)('%s refuses them before any Auth call', async (_name, run, fields) => {
    sharedWithAnotherCompany.mockResolvedValue(true);
    expect(await run(form(fields))).toEqual({ error: SHARED });
    expect(sharedWithAnotherCompany).toHaveBeenCalledWith(id);
    expect(createAdminClient).not.toHaveBeenCalled();
    for (const fn of [setTemporaryPassword, changeAuthEmail, resetAuthFactors, hasVerifiedFactor, sendEmail, rpc]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});
