import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { authenticator } from 'otplib';
import { pgConfig } from '../../scripts/db';
import { adminClient, pendingLoginFor, setProfile } from '../../scripts/users';
import { login, expectDashboard } from './helpers';

const SENT = "If an account exists for that address, we've emailed a link to set a new password. It works for 24 hours.";

// A throwaway organizer login with a known password; deleted afterwards.
async function withUser(prefix: string, fn: (u: { id: string; email: string; password: string }) => Promise<void>) {
  const admin = adminClient();
  const email = `icm-${prefix}-${Date.now()}@example.com`;
  const password = 'Old-password-123';
  await pendingLoginFor(email);
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  expect(error).toBeNull();
  const id = data.user!.id;
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    await setProfile(pg, id, { full_name: 'Reset Tester', role: 'organizer', active: true });
    await fn({ id, email, password });
  } finally {
    await pg.end();
    await admin.auth.admin.deleteUser(id);
  }
}

async function requestReset(page: Page, email: string) {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page).toHaveURL(/\/login\/forgot$/);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toHaveText(SENT);
}

// Mailpit (the local stack's mail catcher): the link in the newest reset email to this address.
async function resetLink(email: string): Promise<string> {
  let id = '';
  await expect
    .poll(
      async () => {
        const res = await fetch(`http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
        const messages: { ID: string; Subject: string }[] = (await res.json()).messages ?? [];
        id = messages.find((m) => m.Subject === 'Reset your password')?.ID ?? '';
        return id;
      },
      { timeout: 20_000 },
    )
    .not.toBe('');
  const html: string = (await (await fetch(`http://127.0.0.1:54324/api/v1/message/${id}`)).json()).HTML;
  const href = html.match(/href="([^"]+)"/)![1].replace(/&amp;/g, '&');
  expect(href).toMatch(/\/auth\/confirm\?token_hash=.+&type=recovery$/);
  return href;
}

async function setNewPassword(page: Page, password: string) {
  await expect(page).toHaveURL(/\/account\/set-password$/);
  await page.getByLabel('New password').fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Save password' }).click();
  await expectDashboard(page);
}

test('a user resets a forgotten password by email and signs in with the new one', async ({ page }) => {
  await withUser('reset', async ({ email }) => {
    await requestReset(page, email);
    await page.goto(await resetLink(email));
    await setNewPassword(page, 'New-password-456');

    await page.getByRole('button', { name: 'Sign out' }).click();
    await login(page, email, 'New-password-456');
    await expectDashboard(page);
  });
});

test('an unknown address gets the same reply', async ({ page }) => {
  await requestReset(page, `icm-nobody-${Date.now()}@example.com`);
});

test('with 2FA, the reset link asks for the code before the new password', async ({ page }) => {
  test.setTimeout(90_000);
  await withUser('reset-mfa', async ({ email, password }) => {
    // Enrol a TOTP factor as the user, through the API.
    const user = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    expect((await user.auth.signInWithPassword({ email, password })).error).toBeNull();
    const { data: enrolled, error: enrollError } = await user.auth.mfa.enroll({ factorType: 'totp' });
    expect(enrollError).toBeNull();
    const secret = enrolled!.totp.secret;
    const first = authenticator.generate(secret);
    expect((await user.auth.mfa.challengeAndVerify({ factorId: enrolled!.id, code: first })).error).toBeNull();

    const { data: link, error } = await adminClient().auth.admin.generateLink({ type: 'recovery', email });
    expect(error).toBeNull();
    await page.goto(`/auth/confirm?token_hash=${link.properties!.hashed_token}&type=recovery`);
    await expect(page).toHaveURL(/\/login\/mfa$/);

    let code = authenticator.generate(secret);
    while (code === first) {
      await new Promise((r) => setTimeout(r, 1000));
      code = authenticator.generate(secret);
    }
    await page.getByLabel('Authentication code').fill(code);
    await page.getByRole('button', { name: 'Verify' }).click();
    await setNewPassword(page, 'New-password-789');
  });
});
