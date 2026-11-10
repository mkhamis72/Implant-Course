import { describe, it, expect } from 'vitest';
import { databaseCa } from './database-ca';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';

describe('databaseCa', () => {
  it('is unset without SELF_AUTH_DATABASE_CA_CERT (local stack: no TLS)', () => {
    expect(databaseCa({})).toBeUndefined();
    expect(databaseCa({ SELF_AUTH_DATABASE_CA_CERT: '  ' })).toBeUndefined();
  });

  it('returns the PEM, multi-line or with literal \\n', () => {
    expect(databaseCa({ SELF_AUTH_DATABASE_CA_CERT: PEM })).toBe(`${PEM}\n`);
    expect(databaseCa({ SELF_AUTH_DATABASE_CA_CERT: PEM.replace(/\n/g, '\\n') })).toBe(`${PEM}\n`);
  });

  it('refuses something that is not a certificate', () => {
    expect(() => databaseCa({ SELF_AUTH_DATABASE_CA_CERT: 'prod-ca.crt' })).toThrow('SELF_AUTH_DATABASE_CA_CERT is not a PEM certificate');
  });
});
