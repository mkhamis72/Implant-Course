import { describe, expect, it } from 'vitest';
import { baseDomain, companyOrigin, suggestSlug } from './onboarding';

describe('suggestSlug', () => {
  it('lower-cases, drops accents and joins words with hyphens', () => {
    expect(suggestSlug('OSDIC Dental Centre')).toBe('osdic-dental-centre');
    expect(suggestSlug('  Clínica  Ñandú & Co. ')).toBe('clinica-nandu-co');
    expect(suggestSlug('مركز')).toBe('');
  });

  it('keeps to 40 characters without a trailing hyphen', () => {
    const s = suggestSlug(`${'a'.repeat(39)} b`);
    expect(s).toBe('a'.repeat(39));
  });
});

describe('baseDomain', () => {
  it('is the console host without its first label', () => {
    expect(baseDomain('console.imploid.net')).toBe('imploid.net');
    expect(baseDomain('console.localhost')).toBe('localhost');
    expect(baseDomain('localhost')).toBeNull();
    expect(baseDomain(null)).toBeNull();
  });
});

describe('companyOrigin', () => {
  it('keeps the console’s scheme and port', () => {
    expect(companyOrigin('https://console.imploid.net', 'acme.imploid.net')).toBe('https://acme.imploid.net');
    expect(companyOrigin('http://console.localhost:3000', 'acme.localhost')).toBe('http://acme.localhost:3000');
  });
});
