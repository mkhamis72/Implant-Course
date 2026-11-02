import { describe, it, expect } from 'vitest';
import { addedToCompanyNotice, emailChangedNotice, inviteEmail } from './notices';

describe('emailChangedNotice', () => {
  const notice = emailChangedNotice({ company: 'Kaleidoscope Academy', newEmail: 'new@example.com' });
  it('has the exact subject and text', () => {
    expect(notice.subject).toBe('Your sign-in email was changed');
    expect(notice.text).toBe(
      "Your sign-in email for Kaleidoscope Academy was changed to new@example.com by an administrator. If you didn't expect this, contact your course organizer.",
    );
  });
  it('carries no link (a notice must not look like a sign-in prompt)', () => {
    expect(notice.text).not.toMatch(/http/i);
    expect(notice.html).not.toMatch(/http|<a\b/i);
  });
  it('escapes the company name and address in the HTML part', () => {
    expect(emailChangedNotice({ company: 'A & <B>', newEmail: 'x@y.z' }).html).toContain('A &amp; &lt;B&gt;');
  });
});

describe('inviteEmail', () => {
  const link = 'https://academy.example.com/auth/confirm?token_hash=abc&type=invite';
  const email = inviteEmail({ company: 'Kaleidoscope Academy', link });
  it('uses the invite subject and the Supabase template wording', () => {
    expect(email.subject).toBe("You're invited to Kaleidoscope Academy");
    expect(email.text).toBe(`You have been invited\n\nAccept the invitation and set your password: ${link}`);
    expect(email.html).toContain('<h2>You have been invited</h2>');
    expect(email.html).toContain(`<a href="https://academy.example.com/auth/confirm?token_hash=abc&amp;type=invite">Accept the invitation and set your password</a>`);
  });
});

describe('addedToCompanyNotice', () => {
  const notice = addedToCompanyNotice({ company: 'Zz Company B' });
  it('has the exact subject and text', () => {
    expect(notice.subject).toBe("You've been added to Zz Company B");
    expect(notice.text).toBe(
      "An administrator added you to Zz Company B. Sign in there with your existing email and password. If you didn't expect this, contact your course organizer.",
    );
  });
  it('carries no link (a notice must not look like a sign-in prompt)', () => {
    expect(notice.text).not.toMatch(/http/i);
    expect(notice.html).not.toMatch(/http|<a\b/i);
  });
  it('escapes the company name in the HTML part', () => {
    expect(addedToCompanyNotice({ company: 'A & <B>' }).html).toContain('A &amp; &lt;B&gt;');
  });
});
