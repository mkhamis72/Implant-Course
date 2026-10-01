import { describe, it, expect } from 'vitest';
import { updateProblem } from './results';

describe('updateProblem (I4: an update that changed nothing is not a success)', () => {
  it('is null when exactly one row was updated', () => {
    expect(updateProblem({ data: [{ user_id: 'x' }], error: null })).toBeNull();
  });
  it('reports zero updated rows (RLS denial or unknown id)', () => {
    expect(updateProblem({ data: [], error: null })).toBe('Nothing was changed. Reload the page and try again.');
    expect(updateProblem({ data: null, error: null })).toBe('Nothing was changed. Reload the page and try again.');
  });
  it('maps the last-admin guard', () => {
    expect(updateProblem({ data: null, error: { message: 'raw', hint: 'last_admin' } })).toBe(
      'At least one active admin is required.',
    );
  });
  it('does not leak raw database errors', () => {
    expect(updateProblem({ data: null, error: { message: 'new row violates row-level security policy' } })).toBe(
      'The change could not be saved. Please try again.',
    );
  });
});
