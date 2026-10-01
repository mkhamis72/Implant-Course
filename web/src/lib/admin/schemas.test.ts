import { describe, it, expect } from 'vitest';
import { inviteSchema, settingsSchema, setActiveSchema } from './schemas';

describe('inviteSchema', () => {
  it('normalizes email and name', () => {
    expect(
      inviteSchema.parse({ email: '  Dr.Ali@Clinic.COM ', full_name: '  Ali Hassan ', role: 'organizer' }),
    ).toEqual({ email: 'dr.ali@clinic.com', full_name: 'Ali Hassan', role: 'organizer' });
  });
  it('rejects bad email, short name and unknown role', () => {
    expect(inviteSchema.safeParse({ email: 'nope', full_name: 'Ali', role: 'organizer' }).error?.issues[0].message)
      .toBe('Enter a valid email address.');
    expect(inviteSchema.safeParse({ email: 'a@b.co', full_name: 'A', role: 'organizer' }).error?.issues[0].message)
      .toBe('Enter the full name (at least 2 characters).');
    expect(inviteSchema.safeParse({ email: 'a@b.co', full_name: 'Ali', role: 'delegate' }).success).toBe(false);
  });
});

describe('settingsSchema', () => {
  it('coerces form strings and enforces ranges', () => {
    expect(settingsSchema.parse({ expiry_alert_days: '60', session_timeout_minutes: '30' })).toEqual({
      expiry_alert_days: 60,
      session_timeout_minutes: 30,
    });
    expect(settingsSchema.safeParse({ expiry_alert_days: '0', session_timeout_minutes: '30' }).success).toBe(false);
    expect(settingsSchema.safeParse({ expiry_alert_days: '60', session_timeout_minutes: '481' }).success).toBe(false);
    expect(settingsSchema.safeParse({ expiry_alert_days: '6.5', session_timeout_minutes: '30' }).success).toBe(false);
  });
});

describe('setActiveSchema', () => {
  it('parses the hidden form values', () => {
    expect(
      setActiveSchema.parse({ user_id: '1b4e28ba-2fa1-41d2-883f-0016d3cca427', active: 'false' }),
    ).toEqual({ user_id: '1b4e28ba-2fa1-41d2-883f-0016d3cca427', active: false });
  });
});
