import { describe, it, expect } from 'vitest';
import { assertSafeTestTarget } from './test-guard';

const ok = {
  ALLOW_TEST_FIXTURES: '1',
  TEST_SUPABASE_PROJECT_REF: 'devref123',
  NEXT_PUBLIC_SUPABASE_URL: 'https://devref123.supabase.co',
  DATABASE_URL: 'postgresql://postgres.devref123:pw@aws-1-eu-central-1.pooler.supabase.com:5432/postgres',
  TEST_USER_PASSWORD: 'Some-test-password-1',
};

describe('assertSafeTestTarget', () => {
  it('accepts the allow-listed dev project', () => {
    expect(() => assertSafeTestTarget(ok)).not.toThrow();
  });
  it('refuses without the explicit opt-in', () => {
    expect(() => assertSafeTestTarget({ ...ok, ALLOW_TEST_FIXTURES: undefined })).toThrow(/ALLOW_TEST_FIXTURES=1/);
  });
  it('refuses when the API URL points at another project', () => {
    expect(() => assertSafeTestTarget({ ...ok, NEXT_PUBLIC_SUPABASE_URL: 'https://prodref999.supabase.co' })).toThrow(
      /not the allow-listed test project/,
    );
  });
  it('refuses when the database URL points at another project', () => {
    expect(() =>
      assertSafeTestTarget({ ...ok, DATABASE_URL: ok.DATABASE_URL.replace('devref123', 'prodref999') }),
    ).toThrow(/not the allow-listed test project/);
  });
  it('refuses without a project ref or test password', () => {
    expect(() => assertSafeTestTarget({ ...ok, TEST_SUPABASE_PROJECT_REF: '' })).toThrow(/TEST_SUPABASE_PROJECT_REF/);
    expect(() => assertSafeTestTarget({ ...ok, TEST_USER_PASSWORD: '' })).toThrow(/TEST_USER_PASSWORD/);
  });
});
