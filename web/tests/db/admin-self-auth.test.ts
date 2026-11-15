import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';
import { temporaryPassword } from '../../src/lib/admin/passwords';
import { closeNodeAuth, nodeAuth } from '../../scripts/self-auth-node';

// Two local companies (academy and company-b); the same person has a separate Self-Auth account in each.
let A: string;
let B: string;
const PASSWORD = 'Admin-tools-pass-1';
const created: string[] = [];

async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    return (await pg.query(text, params)).rows as T[];
  } finally {
    await pg.end();
  }
}

beforeAll(async () => {
  A = (await sql<{ id: string }>("select id from public.companies where slug = 'academy'"))[0].id;
  B = (await sql<{ id: string }>("select id from public.companies where slug = 'company-b'"))[0].id;
});

/** A Self-Auth account made as an invitation is accepted: a pending login first, then the account (its trigger makes the profile and membership). */
async function account(companyId: string, email: string, totpSecret: string | null = null): Promise<string> {
  const userId = randomUUID();
  await sql(`insert into app_private.pending_logins (company_id, email, full_name, role, created_by)
    values ($1, lower($2), 'Zz Admin Tools', 'organizer', '00000000-0000-0000-0000-000000000000')`, [companyId, email]);
  const auth = await nodeAuth();
  await auth.importSupabaseUser({ companyId, userId, email, passwordHash: bcrypt.hashSync(PASSWORD, 10), totpSecret, createdAt: new Date() });
  created.push(userId);
  return userId;
}

async function signIn(companyId: string, email: string) {
  const r = await (await nodeAuth()).signIn({ companyId, email, password: PASSWORD });
  if (!r.ok) throw new Error(`sign-in failed: ${r.reason}`);
  return r;
}

afterAll(async () => {
  const auth = await nodeAuth();
  // deleteUser refuses another company's account, so trying both companies removes each one (and its profile).
  for (const id of created) for (const companyId of [A, B]) await auth.admin.deleteUser(companyId, id).catch(() => undefined);
  await closeNodeAuth();
});

describe('admin user tools on Self-Auth', () => {
  it('deactivate_ends_sessions_in_company_only', async () => {
    const email = `zz-both-${Date.now()}@example.com`;
    const inA = await account(A, email);
    await account(B, email);
    const auth = await nodeAuth();
    const sa = await signIn(A, email);
    const sb = await signIn(B, email);
    expect(await auth.getSession(sa.sessionToken, A)).not.toBeNull();

    await auth.admin.setDisabled(A, inA, true);

    expect(await auth.getSession(sa.sessionToken, A)).toBeNull();
    expect(await auth.getSession(sb.sessionToken, B)).not.toBeNull();
    expect(await auth.signIn({ companyId: A, email, password: PASSWORD })).toEqual({ ok: false, reason: 'disabled' });
    expect((await auth.signIn({ companyId: B, email, password: PASSWORD })).ok).toBe(true);

    await auth.admin.setDisabled(A, inA, false);
    expect((await auth.signIn({ companyId: A, email, password: PASSWORD })).ok).toBe(true);
  });

  it('admin_cannot_touch_other_company_user', async () => {
    const email = `zz-other-${Date.now()}@example.com`;
    const inB = await account(B, email, authenticator.generateSecret());
    const auth = await nodeAuth();
    const s = await signIn(B, email);
    for (const act of [
      () => auth.admin.setDisabled(A, inB, true),
      () => auth.admin.resetTotp(A, inB),
      () => auth.admin.updateEmail(A, inB, `zz-moved-${Date.now()}@example.com`),
      () => auth.admin.deleteUser(A, inB),
    ]) {
      await expect(act()).rejects.toMatchObject({ code: 'user_not_found' });
    }
    // Nothing changed in B: still enabled, still has its authenticator, same address, session alive.
    const row = (await auth.admin.listUsers(B)).find((u) => u.userId === inB)!;
    expect(row).toMatchObject({ email, disabled: false, hasTotp: true });
    expect(await auth.getSession(s.sessionToken, B)).not.toBeNull();
  });

  it('set_password_signs_in_and_ends_sessions: the one-time password works, the old password and sessions do not', async () => {
    const email = `zz-otp-${Date.now()}@example.com`;
    const id = await account(A, email);
    const auth = await nodeAuth();
    const before = await signIn(A, email);
    const otp = temporaryPassword();
    await auth.admin.setPassword(A, id, otp);
    expect(await auth.getSession(before.sessionToken, A)).toBeNull();
    expect((await auth.signIn({ companyId: A, email, password: PASSWORD })).ok).toBe(false);
    expect((await auth.signIn({ companyId: A, email, password: otp })).ok).toBe(true);
    await expect(auth.admin.setPassword(B, id, temporaryPassword())).rejects.toMatchObject({ code: 'user_not_found' });
  });

  it('reset_2fa_forces_reenroll', async () => {
    const email = `zz-mfa-${Date.now()}@example.com`;
    const secret = authenticator.generateSecret();
    const id = await account(A, email, secret);
    const auth = await nodeAuth();
    const before = await signIn(A, email);
    expect(before.needsTotp).toBe(true);

    await auth.admin.resetTotp(A, id);

    expect(await auth.getSession(before.sessionToken, A)).toBeNull();
    expect((await auth.admin.listUsers(A)).find((u) => u.userId === id)!.hasTotp).toBe(false);
    // The next sign-in has no code step (nothing to verify): the app's mfa_setup_required flag then sends the user to enrol.
    const after = await signIn(A, email);
    expect(after.needsTotp).toBeFalsy();
    const enrol = await auth.totp.startEnroll(after.sessionToken, A);
    const done = await auth.totp.confirmEnroll(after.sessionToken, A, authenticator.generate(enrol.secret));
    expect(done?.aal).toBe('aal2');
  });
});
