import { describe, it, expect } from 'vitest';
import { parseConsoleAdminArgs } from './console-admin';

describe('parseConsoleAdminArgs', () => {
  it('takes one email, lower-cased', () => {
    expect(parseConsoleAdminArgs([' Owner@Example.com '])).toEqual({ email: 'owner@example.com' });
  });
  it('refuses anything else', () => {
    expect(() => parseConsoleAdminArgs([])).toThrow('Usage: npm run console:admin -- <email>');
    expect(() => parseConsoleAdminArgs(['not-an-email'])).toThrow('Usage: npm run console:admin -- <email>');
  });
});
