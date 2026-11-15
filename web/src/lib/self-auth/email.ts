import 'server-only';
import type { EmailAdapter } from '@mkhamis72/self-auth';
import { sendEmail } from '@/lib/email/send';
import { CONSOLE_COMPANY } from './constants';
import { companyBaseUrl } from './links';

// Ported from the Supabase Auth invite and recovery templates of before Self-Auth.
const TEMPLATES = {
  invite: { subject: 'You have been invited', heading: 'You have been invited', label: 'Accept the invitation and set your password' },
  reset: { subject: 'Reset your password', heading: 'Reset your password', label: 'Set a new password' },
} as const;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Sends Self-Auth's invite and reset links to the real address through the app's SMTP. The link is only in the body. */
export const emailAdapter: EmailAdapter = {
  async send(msg) {
    const t = TEMPLATES[msg.kind];
    // The console host serves only /console…, so its links land on the console's own pages.
    const path = msg.companyId === CONSOLE_COMPANY ? `/console${msg.url}` : msg.url;
    const url = msg.url.startsWith('/') ? `${await companyBaseUrl(msg.companyId)}${path}` : msg.url;
    const result = await sendEmail({
      to: msg.to,
      subject: t.subject,
      text: `${t.heading}\n\n${t.label}: ${url}\n`,
      html: `<h2>${t.heading}</h2>\n<p><a href="${esc(url)}">${t.label}</a></p>`,
    });
    // Self-Auth sends reset/invite through us; surface a failed send (never the url) to its onError.
    if (result !== 'sent') throw new Error(`email_${result}`);
  },
};
