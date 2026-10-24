export type NoticeEmail = { subject: string; text: string; html: string };

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Sent after an admin changes someone's sign-in email. No link on purpose: it must not look like a sign-in prompt. */
export function emailChangedNotice(a: { company: string; newEmail: string }): NoticeEmail {
  const text = `Your sign-in email for ${a.company} was changed to ${a.newEmail} by an administrator. If you didn't expect this, contact your course organizer.`;
  return { subject: 'Your sign-in email was changed', text, html: `<p>${escapeHtml(text)}</p>` };
}

/** A resent invitation, worded like the Supabase invite template (supabase/templates/invite.html). */
export function inviteEmail(a: { company: string; link: string }): NoticeEmail {
  return {
    subject: `You're invited to ${a.company}`,
    text: `You have been invited\n\nAccept the invitation and set your password: ${a.link}`,
    html: `<h2>You have been invited</h2>\n<p><a href="${escapeHtml(a.link)}">Accept the invitation and set your password</a></p>`,
  };
}
