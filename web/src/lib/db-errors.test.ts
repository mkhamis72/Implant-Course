import { describe, it, expect, vi } from 'vitest';
import { userMessage } from './db-errors';

describe('userMessage', () => {
  it('passes through business messages raised with hint=user', () => {
    expect(userMessage({ message: 'Lot A1 expired on 2020-01-31. Choose another batch.', hint: 'user', code: 'P0001' })).toBe(
      'Lot A1 expired on 2020-01-31. Choose another batch.',
    );
  });
  it('explains permission errors and hides everything else', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(userMessage({ message: 'Not allowed', code: '42501' })).toBe(
      'You are not allowed to do that. Your session may have ended — sign in again.',
    );
    expect(userMessage({ message: 'syntax error at or near', code: '42601' })).toBe('Something went wrong. Please try again.');
    expect(userMessage(null)).toBeNull();
  });
});
