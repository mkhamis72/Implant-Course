import { describe, it, expect } from 'vitest';
import { emailChangedNotice } from './notices';

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
