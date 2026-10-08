import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ME = '00000000-0000-4000-8000-0000000000aa'; // the signed-in editor
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ requirePermission: async () => ({ user_id: ME, full_name: 'Dr Sara', email: 'sara@example.com' }) }));
vi.mock('@/lib/branding/get', () => ({ getBranding: async () => ({ name: 'Cairo Implant Academy' }) }));
vi.mock('@/lib/tenant/current', () => ({ requestOrigin: async () => 'https://academy.example' }));
type Mail = { to: string; subject: string; text: string; html: string };
const sendEmail = vi.fn<(e: Mail) => Promise<'sent' | 'failed' | 'not-configured'>>(async () => 'sent');
vi.mock('@/lib/email/send', () => ({ sendEmail: (e: Mail) => sendEmail(e) }));

const ITEM = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
let before: Record<string, unknown> = {};
const update = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === 'profiles' ? { data: { full_name: 'Dr Omar', email: 'omar@example.com' } } : { data: before },
        }),
      }),
      update: (fields: unknown) => {
        update(fields);
        return { eq: () => ({ select: async () => ({ data: [{ id: ITEM }], error: null }) }) };
      },
    }),
  }),
}));

import { editItem } from './actions';

const edit = (over: Record<string, unknown> = {}) =>
  editItem({ id: ITEM, checklistId: 'c1', text: 'Call the lab', assignee_id: OTHER, due_date: '', ...over });

beforeEach(() => {
  vi.clearAllMocks();
  before = { text: 'Call the lab', assignee_id: null, due_date: null, checklist_id: 'c1', checklist: { title: 'May course' } };
});
afterEach(() => vi.unstubAllEnvs());

describe('editItem assignment email', () => {
  it('saves, then emails the new assignee with a link to the checklist', async () => {
    expect(await edit()).toEqual({});
    expect(update).toHaveBeenCalledWith({ text: 'Call the lab', assignee_id: OTHER, due_date: null });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = sendEmail.mock.calls[0][0];
    expect(mail.to).toBe('omar@example.com');
    expect(mail.subject).toBe("Checklist: you've been assigned an item");
    expect(mail.text).toContain('https://academy.example/checklists/c1');
    expect(mail.text).toContain('May course');
  });

  it('emails about a due date change to an item already assigned', async () => {
    before = { ...before, assignee_id: OTHER };
    await edit({ due_date: '2031-01-15' });
    expect(sendEmail.mock.calls[0][0].subject).toBe('Checklist: an item assigned to you changed');
  });

  it('sends nothing for a self-assignment or when email is switched off', async () => {
    await edit({ assignee_id: ME });
    vi.stubEnv('EMAIL_ENABLED', 'false');
    await edit();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('keeps the save and warns when the email fails', async () => {
    sendEmail.mockResolvedValueOnce('failed');
    expect(await edit()).toEqual({ warning: "Saved, but the email to Dr Omar couldn't be sent." });
    expect(update).toHaveBeenCalled();
  });
});
