import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { createLogin, rpc, deleteAuthUser, sendPasswordLink, setOneTimePassword, setAuthDisabled, changeAuthEmail, resetAuthFactors, listAccounts, sendEmail, hasVerifiedFactor, unlinkGoogle } = vi.hoisted(() => ({
  createLogin: vi.fn(), rpc: vi.fn(), deleteAuthUser: vi.fn(), sendPasswordLink: vi.fn(), setOneTimePassword: vi.fn(), setAuthDisabled: vi.fn(),
  changeAuthEmail: vi.fn(), resetAuthFactors: vi.fn(), listAccounts: vi.fn(), sendEmail: vi.fn(), hasVerifiedFactor: vi.fn(), unlinkGoogle: vi.fn(),
}));
const { memberOfMyCompany, profileRemains } = vi.hoisted(() => ({ memberOfMyCompany: vi.fn(), profileRemains: vi.fn() }));
vi.mock('@/lib/admin/same-company', () => ({ memberOfMyCompany, profileRemains, USER_NOT_FOUND: 'User not found.' }));
vi.mock('@/lib/tenant/current', () => ({ currentTenant: vi.fn(async () => ({ slug: 'academy', companyId: 'a7c0de00-0000-4000-8000-000000000001' })) }));
const { ME } = vi.hoisted(() => ({ ME: '9c1d6e2a-3b4f-4a5e-8d7c-1f2e3d4c5b6a' }));
const { features } = vi.hoisted(() => ({ features: { value: ['teaching'] as string[] } }));
vi.mock('@/lib/auth/session', () => ({ requireAdmin: vi.fn(async () => ({ user_id: ME, features: features.value })) }));
vi.mock('@/lib/admin/create-login', () => ({ createLogin }));
vi.mock('@/lib/admin/auth-accounts', () => ({ deleteAuthUser, sendPasswordLink, setOneTimePassword, setAuthDisabled, changeAuthEmail, resetAuthFactors, listAccounts, hasVerifiedFactor, unlinkGoogle }));
vi.mock('@/lib/email/send', () => ({ sendEmail }));
vi.mock('@/lib/branding/get', () => ({ getBranding: vi.fn(async () => ({ name: 'Academy' })) }));
const { flagged } = vi.hoisted(() => ({ flagged: { value: false } }));
const { fromTable, eqs } = vi.hoisted(() => ({ fromTable: vi.fn(), eqs: vi.fn() }));
const memberQuery: { select: () => unknown; eq: (c: string, v: unknown) => unknown; maybeSingle: () => Promise<unknown> } = {
  select: () => memberQuery,
  eq: (c, v) => (eqs(c, v), memberQuery),
  maybeSingle: async () => ({ data: { mfa_setup_required: flagged.value }, error: null }),
};
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ rpc, from: (t: string) => (fromTable(t), memberQuery) })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { changeEmail, editName, inviteUser, removeUser, resendInvite, resetGoogle, resetPassword, resetTwoFactor, savePermissions, setUserActive, setUserRole } from './actions';

beforeEach(() => {
  vi.clearAllMocks();
  flagged.value = false;
  features.value = ['teaching'];
  memberOfMyCompany.mockResolvedValue(true);
  setAuthDisabled.mockResolvedValue(null);
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
  it('a clinic passes the doctor choice; a course organizer company never does', async () => {
    createLogin.mockResolvedValue({ ok: 'Invitation sent to new@example.com.' });
    const fields = { email: 'new@example.com', full_name: 'Dr New', role: 'organizer', doctor: 'new' };
    await inviteUser({}, form(fields));
    expect(createLogin).toHaveBeenLastCalledWith({ email: 'new@example.com', full_name: 'Dr New', role: 'organizer' });
    features.value = ['inventory'];
    await inviteUser({}, form(fields));
    expect(createLogin).toHaveBeenLastCalledWith({ email: 'new@example.com', full_name: 'Dr New', role: 'organizer', doctor_id: null, new_doctor: true });
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
  afterEach(() => vi.unstubAllEnvs());
  it('has Self-Auth email the user a link; the admin gets no password and no link', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'true');
    sendPasswordLink.mockResolvedValue({ email: 'new@example.com' });
    expect(await resetPassword({}, form({ user_id: id }))).toEqual({ ok: 'Password reset email sent to new@example.com.' });
    expect(sendPasswordLink).toHaveBeenCalledWith(id);
  });
  it('is not for your own account', async () => {
    expect(await resetPassword({}, form({ user_id: ME }))).toHaveProperty('error');
    expect(sendPasswordLink).not.toHaveBeenCalled();
  });
  it('email_off_reset_shows_one_time_password: sets it, ends the sessions, shows it once', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'false');
    setOneTimePassword.mockResolvedValue({ password: 'One-Time-Pass-1234' });
    rpcAnswers({});
    expect(await resetPassword({}, form({ user_id: id }))).toEqual({ ok: 'New one-time password set. Everywhere they were signed in, they are signed out.', password: 'One-Time-Pass-1234' });
    expect(setOneTimePassword).toHaveBeenCalledWith(id);
    expect(sendPasswordLink).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('admin_end_sessions', { p_user: id });
  });
  it('email off: a user outside the company is refused before anything is set', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'false');
    memberOfMyCompany.mockResolvedValue(false);
    expect(await resetPassword({}, form({ user_id: id }))).toEqual({ error: 'User not found.' });
    expect(setOneTimePassword).not.toHaveBeenCalled();
  });
  it('email off: a failure to set shows no password and ends nothing', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'false');
    setOneTimePassword.mockResolvedValue({ error: 'Something went wrong. Please try again.' });
    expect(await resetPassword({}, form({ user_id: id }))).toEqual({ error: 'Something went wrong. Please try again.' });
    expect(rpc).not.toHaveBeenCalled();
  });
  it('email off: still gives the password when Supabase-bound sessions could not be ended, and says so', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'false');
    setOneTimePassword.mockResolvedValue({ password: 'One-Time-Pass-1234' });
    rpcAnswers({ admin_end_sessions: { message: 'nope' } });
    expect(await resetPassword({}, form({ user_id: id }))).toEqual({
      ok: 'New one-time password set, but existing sessions could not be ended: nope', password: 'One-Time-Pass-1234',
    });
  });
  it('passes on a Self-Auth refusal', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'true');
    sendPasswordLink.mockResolvedValue({ error: 'User not found.' });
    expect(await resetPassword({}, form({ user_id: id }))).toEqual({ error: 'User not found.' });
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

describe('resetGoogle', () => {
  const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
  it('reset_google_unlinks_member_of_my_company', async () => {
    unlinkGoogle.mockResolvedValue(null);
    expect(await resetGoogle({}, form({ user_id: id }))).toEqual({ ok: 'Google sign-in reset. Their next Google sign-in is remembered instead.' });
    expect(unlinkGoogle).toHaveBeenCalledWith(id);
  });
  it('shows the failure when unlinking fails', async () => {
    unlinkGoogle.mockResolvedValue('Something went wrong. Please try again.');
    expect(await resetGoogle({}, form({ user_id: id }))).toEqual({ error: 'Something went wrong. Please try again.' });
  });
  it('refuses your own account, whatever the case of the id', async () => {
    expect(await resetGoogle({}, form({ user_id: ME.toUpperCase() }))).toEqual({ error: SELF });
    expect(unlinkGoogle).not.toHaveBeenCalled();
  });
  it('refuses a user of another company', async () => {
    memberOfMyCompany.mockResolvedValue(false);
    expect(await resetGoogle({}, form({ user_id: id }))).toEqual({ error: 'User not found.' });
    expect(unlinkGoogle).not.toHaveBeenCalled();
  });
  it('refuses a bad id', async () => {
    expect(await resetGoogle({}, form({ user_id: 'nope' }))).toEqual({ error: 'Invalid request.' });
    expect(unlinkGoogle).not.toHaveBeenCalled();
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
  afterEach(() => vi.unstubAllEnvs());
  it('has Self-Auth email the invitation again for a user without a password, and records it', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'true');
    listAccounts.mockResolvedValue(new Map([[id, { lastSignIn: null, hasFactor: false, hasPassword: false }]]));
    sendPasswordLink.mockResolvedValue({ email: 'new@example.com' });
    rpcAnswers({});
    expect(await resendInvite({}, form({ user_id: id }))).toEqual({ ok: 'Invitation sent again to new@example.com.' });
    expect(sendPasswordLink).toHaveBeenCalledWith(id);
    expect(rpc).toHaveBeenCalledWith('admin_record_event', { p_user: id, p_kind: 'invite_resent' });
  });
  it('is refused once they have a password', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'true');
    listAccounts.mockResolvedValue(new Map([[id, { lastSignIn: null, hasFactor: false, hasPassword: true }]]));
    expect(await resendInvite({}, form({ user_id: id }))).toHaveProperty('error');
    expect(sendPasswordLink).not.toHaveBeenCalled();
  });
  it('is refused once they have signed in with Google', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'true');
    listAccounts.mockResolvedValue(new Map([[id, { lastSignIn: null, hasFactor: false, hasPassword: false, hasGoogle: true }]]));
    expect(await resendInvite({}, form({ user_id: id }))).toHaveProperty('error');
    expect(sendPasswordLink).not.toHaveBeenCalled();
  });
  it('records nothing when Self-Auth refuses', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'true');
    listAccounts.mockResolvedValue(new Map([[id, { lastSignIn: null, hasFactor: false, hasPassword: false }]]));
    sendPasswordLink.mockResolvedValue({ error: 'Something went wrong. Please try again.' });
    expect(await resendInvite({}, form({ user_id: id }))).toHaveProperty('error');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('is off while email is off', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'false');
    expect(await resendInvite({}, form({ user_id: id }))).toHaveProperty('error');
    expect(sendPasswordLink).not.toHaveBeenCalled();
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
    for (const fn of [deleteAuthUser, sendPasswordLink, setOneTimePassword, setAuthDisabled, changeAuthEmail, resetAuthFactors, listAccounts, hasVerifiedFactor, sendEmail, rpc]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
  it('resetPassword goes ahead for a member', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'true');
    sendPasswordLink.mockResolvedValue({ email: 'a@example.com' });
    expect(await resetPassword({}, form({ user_id: id }))).toMatchObject({ ok: 'Password reset email sent to a@example.com.' });
    expect(sendPasswordLink).toHaveBeenCalledTimes(1);
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
  it("deactivates the membership through set_member_active, then disables this company's sign-in (which ends its sessions)", async () => {
    rpcAnswers({});
    expect(await setUserActive({}, form({ user_id: id, active: 'false' }))).toEqual({ ok: 'User deactivated.' });
    expect(rpc).toHaveBeenCalledWith('set_member_active', { p_user: id, p_active: false });
    expect(setAuthDisabled).toHaveBeenCalledWith(id, true);
  });
  it('reactivates the membership and the sign-in', async () => {
    rpcAnswers({});
    expect(await setUserActive({}, form({ user_id: id, active: 'true' }))).toEqual({ ok: 'User reactivated.' });
    expect(rpc).toHaveBeenCalledWith('set_member_active', { p_user: id, p_active: true });
    expect(setAuthDisabled).toHaveBeenCalledWith(id, false);
  });
  it('reports a Self-Auth failure', async () => {
    rpcAnswers({});
    setAuthDisabled.mockResolvedValue('Something went wrong. Please try again.');
    expect(await setUserActive({}, form({ user_id: id, active: 'false' }))).toEqual({ error: 'Something went wrong. Please try again.' });
  });
  it('touches no sign-in when the database refuses', async () => {
    rpcAnswers({ set_member_active: { message: 'User not found.', hint: 'user' } });
    expect(await setUserActive({}, form({ user_id: id, active: 'false' }))).toEqual({ error: 'User not found.' });
    expect(setAuthDisabled).not.toHaveBeenCalled();
  });
  it('is not for your own account', async () => {
    expect(await setUserActive({}, form({ user_id: ME, active: 'false' }))).toHaveProperty('error');
    expect(setAuthDisabled).not.toHaveBeenCalled();
  });
});
