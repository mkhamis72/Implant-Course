import { escapeHtml } from '@/lib/html';
export type NoticeEmail = { subject: string; text: string; html: string };


/** Sent after an admin changes someone's sign-in email. No link on purpose: it must not look like a sign-in prompt. */
export function emailChangedNotice(a: { company: string; newEmail: string }): NoticeEmail {
  const text = `Your sign-in email for ${a.company} was changed to ${a.newEmail} by an administrator. If you didn't expect this, contact your course organizer.`;
  return { subject: 'Your sign-in email was changed', text, html: `<p>${escapeHtml(text)}</p>` };
}

