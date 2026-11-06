import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { uniqueName } from './patients';
import { apiAs, enroll, randomFutureDate, seedChair, seedCourse, seedDelegate, seedLecturer, seedSession } from './api';

// The test delegate login's link to its delegate record: the membership holds it (profiles has no delegate_id).
async function delegateLink(admin: Awaited<ReturnType<typeof apiAs>>): Promise<{ delegate_id: string }> {
  const { data: profile } = await admin.from('profiles').select('user_id').eq('email', TEST_USERS.delegate.email).single();
  const { data: member } = await admin.from('company_members').select('delegate_id').eq('user_id', profile!.user_id).single();
  return { delegate_id: member!.delegate_id as string };
}

test('a delegate sees only their own bookings and their courses’ talks, and their own report', async ({ page }) => {
  const admin = await apiAs(TEST_USERS.admin.email);
  const api = await apiAs(TEST_USERS.organizer.email);
  const supervisor = (await api.auth.getUser()).data.user!.id;
  const link = await delegateLink(admin);
  const me = link.delegate_id as string;

  const date = randomFutureDate();
  const chair = await seedChair(admin, uniqueName('Chair'));
  const lecturer = await seedLecturer(admin, uniqueName('Lecturer'));
  const courseId = await seedCourse(api, { name: uniqueName('Course'), start: date, end: date });
  const surgery = await seedSession(api, { courseId, type: 'surgery', title: 'Surgery day', date });
  const lecture = await seedSession(api, { courseId, type: 'lecture', title: 'Lectures', date, start: '08:00', end: '12:00', room: 'Hall B' });
  const other = await seedDelegate(api, uniqueName('Dr Other'));
  await enroll(api, courseId, me).catch(() => {});
  await enroll(api, courseId, other);

  const mine = uniqueName('Mine patient');
  const theirs = uniqueName('Their patient');
  const { data: p1 } = await api.from('patients').insert({ full_name: mine }).select('id').single();
  const { data: p2 } = await api.from('patients').insert({ full_name: theirs }).select('id').single();
  for (const [patient, placing, start, end] of [[p1!.id, me, '13:00', '14:00'], [p2!.id, other, '14:00', '15:00']] as const) {
    const { error } = await api.rpc('create_surgery_slot', {
      p_session: surgery, p_chair: chair, p_start: start, p_end: end, p_patient: patient, p_supervisor: supervisor,
      p_placing: [placing], p_implants: [{ tooth: 36, technique: 'guided' }], p_override_reason: 'E2E delegate portal',
    });
    expect(error).toBeNull();
  }
  const topic = uniqueName('Talk');
  const { error: talkError } = await api.rpc('create_talk', {
    p_session: lecture, p_start: '09:00', p_end: '10:00', p_lecturer: lecturer, p_topic: topic,
  });
  expect(talkError).toBeNull();

  await login(page, TEST_USERS.delegate.email);
  await expect(page).toHaveURL(/\/my$/);
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Patients' })).toHaveCount(0);

  await page.goto(`/my?date=${date}`);
  await expect(page.getByText(mine)).toBeVisible();
  await expect(page.getByText(topic)).toBeVisible();
  await expect(page.getByText('Hall B')).toBeVisible();
  await expect(page.getByText(theirs)).toHaveCount(0);

  await page.goto('/patients');
  await expect(page).toHaveURL(/\/my$/);

  await page.goto('/my/report');
  await expect(page.getByRole('heading', { level: 1, name: 'My report' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
});

test('an admin is told to add an email before creating a delegate login', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const id = await seedDelegate(api, uniqueName('Dr No Email'));
  await login(page, TEST_USERS.admin.email);
  await page.goto(`/delegates/${id}`);
  await page.getByRole('button', { name: 'Create login' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Add the delegate’s email address first.' })).toBeVisible();
});

test('the delegate page shows an existing login', async ({ page }) => {
  const admin = await apiAs(TEST_USERS.admin.email);
  const link = await delegateLink(admin);
  await login(page, TEST_USERS.admin.email);
  await page.goto(`/delegates/${link.delegate_id}`);
  await expect(page.getByText(`Login ${TEST_USERS.delegate.email}: active`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create login' })).toHaveCount(0);
  // A lost one-time password can be replaced from here (not pressed: it would change the shared test login).
  await expect(page.getByRole('button', { name: 'Reset password' })).toBeVisible();
});

test('a delegate can reach Account security and the set-password page', async ({ page }) => {
  await login(page, TEST_USERS.delegate.email);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Account security' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Account security' })).toBeVisible();
  await page.goto('/account/set-password');
  await expect(page.getByRole('heading', { level: 1, name: 'Set your password' })).toBeVisible();
});
