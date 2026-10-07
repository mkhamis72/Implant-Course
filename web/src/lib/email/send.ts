import 'server-only';
import nodemailer from 'nodemailer';

type Env = Record<string, string | undefined>;
export type Email = { to: string; subject: string; text: string; html: string };
export type SendResult = 'sent' | 'not-configured' | 'failed';

/** SMTP settings from SMTP_HOST/PORT/USER/PASS/FROM; null (email off) without SMTP_HOST. */
export function smtpConfig(env: Env = process.env) {
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number(env.SMTP_PORT || 465);
  return {
    transport: {
      host,
      port,
      secure: port === 465,
      ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } } : {}),
    },
    from: env.SMTP_FROM || 'Implant Course <no-reply@localhost>',
  };
}

/** The app's own emails (not Auth's). Never throws: a failed send must not undo the change that caused it. */
export async function sendEmail(email: Email, env: Env = process.env): Promise<SendResult> {
  const config = smtpConfig(env);
  if (!config) return 'not-configured';
  try {
    await nodemailer.createTransport(config.transport).sendMail({ ...email, from: config.from });
    return 'sent';
  } catch (e) {
    console.error('sendEmail failed:', e instanceof Error ? e.message : e);
    return 'failed';
  }
}
