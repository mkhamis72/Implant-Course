import { describe, it, expect } from 'vitest';
import { historyLabel } from './history';

const at = '2026-10-23T10:00:00Z';

describe('historyLabel', () => {
  it('gives each kind its label', () => {
    const label = (kind: string) => historyLabel({ at, actor_name: 'Dr Admin', kind });
    expect(label('email_changed')).toBe('Email changed by Dr Admin · 23 Oct 2026');
    expect(label('name_changed')).toBe('Name changed by Dr Admin · 23 Oct 2026');
    expect(label('mfa_reset')).toBe('2FA reset by Dr Admin · 23 Oct 2026');
    expect(label('invite_resent')).toBe('Invite resent by Dr Admin · 23 Oct 2026');
    expect(label('email_change_incomplete')).toBe('Email change incomplete · 23 Oct 2026');
  });

  it('leaves the actor out when there is none', () => {
    expect(historyLabel({ at, actor_name: null, kind: 'email_changed' })).toBe('Email changed · 23 Oct 2026');
  });

  it('dates by the Cairo day', () => {
    expect(historyLabel({ at: '2026-10-23T22:30:00Z', actor_name: 'A', kind: 'name_changed' })).toBe('Name changed by A · 24 Oct 2026');
  });
});
