import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
const sendMail = vi.fn(async () => ({ messageId: 'm1' }));
const createTransport = vi.fn<(opts: unknown) => { sendMail: typeof sendMail }>(() => ({ sendMail }));
vi.mock('nodemailer', () => ({ default: { createTransport: (o: unknown) => createTransport(o) } }));

import { sendEmail, smtpConfig } from './send';

const gmail = { SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '465', SMTP_USER: 'app@gmail.com', SMTP_PASS: 'app-pass', SMTP_FROM: 'Implant Course <app@gmail.com>' };
const message = { to: 'x@example.com', subject: 'S', text: 'T', html: '<p>T</p>' };

beforeEach(() => vi.clearAllMocks());

describe('smtpConfig', () => {
  it('is null without SMTP_HOST, so email stays off until it is configured', () => {
    expect(smtpConfig({})).toBeNull();
  });

  it('uses TLS on 465 and logs in when a user is given', () => {
    expect(smtpConfig(gmail)).toEqual({
      transport: { host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: 'app@gmail.com', pass: 'app-pass' } },
      from: 'Implant Course <app@gmail.com>',
    });
  });

  it('suits the local Mailpit: no TLS, no login, a default sender', () => {
    expect(smtpConfig({ SMTP_HOST: '127.0.0.1', SMTP_PORT: '54325' })).toEqual({
      transport: { host: '127.0.0.1', port: 54325, secure: false },
      from: 'Implant Course <no-reply@localhost>',
    });
  });
});

describe('sendEmail', () => {
  it('does nothing when email is not configured', async () => {
    expect(await sendEmail(message, {})).toBe('not-configured');
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('sends from the configured address', async () => {
    expect(await sendEmail(message, gmail)).toBe('sent');
    expect(sendMail).toHaveBeenCalledWith({ ...message, from: gmail.SMTP_FROM });
  });

  it('reports a failure instead of throwing', async () => {
    sendMail.mockRejectedValueOnce(new Error('535 bad login'));
    vi.spyOn(console, 'error').mockImplementationOnce(() => {});
    expect(await sendEmail(message, gmail)).toBe('failed');
  });
});
