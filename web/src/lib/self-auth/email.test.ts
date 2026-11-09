import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendEmail, companyBaseUrl } = vi.hoisted(() => ({ sendEmail: vi.fn(), companyBaseUrl: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/email/send', () => ({ sendEmail }));
vi.mock('./links', () => ({ companyBaseUrl }));
import { emailAdapter } from './email';

beforeEach(() => {
  vi.clearAllMocks();
  companyBaseUrl.mockResolvedValue('https://kaleidoscope.imploid.net');
  sendEmail.mockResolvedValue('sent');
});

describe('email adapter', () => {
  it('email_adapter_renders_invite_and_reset', async () => {
    await emailAdapter.send({ to: 'real@example.com', kind: 'invite', url: '/auth/invite?token=T1', companyId: 'c' });
    await emailAdapter.send({ to: 'real@example.com', kind: 'reset', url: '/auth/reset?token=T2', companyId: 'c' });
    const [invite, reset] = sendEmail.mock.calls.map((c) => c[0]);
    expect(invite.to).toBe('real@example.com');
    expect(invite.subject).toBe('You have been invited');
    expect(invite.html).toContain('<a href="https://kaleidoscope.imploid.net/auth/invite?token=T1">Accept the invitation and set your password</a>');
    expect(invite.text).toContain('https://kaleidoscope.imploid.net/auth/invite?token=T1');
    expect(reset.subject).toBe('Reset your password');
    expect(reset.html).toContain('<a href="https://kaleidoscope.imploid.net/auth/reset?token=T2">Set a new password</a>');
    // The url is only in the body.
    for (const m of [invite, reset]) expect(m.subject).not.toMatch(/https?:|token/);
  });
  it('console links open on the console pages, since the console host serves only /console', async () => {
    companyBaseUrl.mockResolvedValue('https://console.imploid.net');
    await emailAdapter.send({ to: 'a@b.c', kind: 'reset', url: '/auth/reset?token=T3', companyId: 'console' });
    expect(sendEmail.mock.calls[0][0].text).toContain('https://console.imploid.net/console/auth/reset?token=T3');
  });
  it('escapes the url in html', async () => {
    await emailAdapter.send({ to: 'a@b.c', kind: 'reset', url: '/auth/reset?token=a"b&c', companyId: 'c' });
    expect(sendEmail.mock.calls[0][0].html).toContain('token=a&quot;b&amp;c');
  });
  it('throws when the send did not happen, so Self-Auth reports it', async () => {
    sendEmail.mockResolvedValue('failed');
    await expect(emailAdapter.send({ to: 'a@b.c', kind: 'reset', url: '/x', companyId: 'c' })).rejects.toThrow();
  });
});
