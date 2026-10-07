import { describe, it, expect } from 'vitest';
import { assertLocalStacks } from './console-local';

const dev = { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' };
const dev2 = { NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54421', DATABASE_URL: 'postgresql://postgres:postgres@localhost:54422/postgres' };
const msg = 'console:local only runs against local stacks (127.0.0.1/localhost); check .env.local and .env.dev2.';

describe('assertLocalStacks', () => {
  it('accepts two local stacks', () => {
    expect(() => assertLocalStacks(dev, dev2)).not.toThrow();
  });
  it('refuses any hosted host', () => {
    expect(() => assertLocalStacks({ ...dev, NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co' }, dev2)).toThrow(msg);
    expect(() => assertLocalStacks(dev, { ...dev2, DATABASE_URL: 'postgresql://u:p@db.abc.supabase.co:5432/postgres' })).toThrow(msg);
  });
  it('refuses a missing or unparseable value', () => {
    expect(() => assertLocalStacks({ ...dev, DATABASE_URL: '' }, dev2)).toThrow(msg);
    expect(() => assertLocalStacks(dev, { NEXT_PUBLIC_SUPABASE_URL: dev2.NEXT_PUBLIC_SUPABASE_URL })).toThrow(msg);
    expect(() => assertLocalStacks(dev, { ...dev2, DATABASE_URL: 'not a url' })).toThrow(msg);
  });
});
