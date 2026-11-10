import { describe, it, expect } from 'vitest';
import { FORGOT_SENT, FORGOT_TOO_MANY } from './password-reset';

describe('password reset replies', () => {
  it('are fixed strings that do not mention accounts', () => {
    expect(FORGOT_SENT).toMatch(/^If an account exists/);
    expect(FORGOT_TOO_MANY).toMatch(/Too many requests/);
  });
});
