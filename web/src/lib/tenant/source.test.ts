import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));
import { listSource } from './source';

afterEach(() => vi.restoreAllMocks());

describe('listSource', () => {
  it('nothing set: static (TENANTS_FILE or the single company)', () => {
    expect(listSource({})).toBe('static');
  });
  it('a control project: control', () => {
    expect(listSource({ CONTROL_SUPABASE_URL: 'x' })).toBe('control');
  });
  it('COMPANY_LIST=production wins, whatever its case and spaces', () => {
    expect(listSource({ COMPANY_LIST: ' Production ' })).toBe('production');
    expect(listSource({ COMPANY_LIST: 'production', CONTROL_SUPABASE_URL: 'x' })).toBe('production');
  });
  it('an unknown value is treated as unset and logged once, never taking the sites down', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(listSource({ COMPANY_LIST: 'prod', CONTROL_SUPABASE_URL: 'x' })).toBe('control');
    expect(listSource({ COMPANY_LIST: 'prod', CONTROL_SUPABASE_URL: 'x' })).toBe('control');
    expect(err).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledWith('COMPANY_LIST=prod is not a known value; using the control project');
  });
  it('an empty value is simply unset', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(listSource({ COMPANY_LIST: '  ' })).toBe('static');
    expect(err).not.toHaveBeenCalled();
  });
});
