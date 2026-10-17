import { describe, it, expect } from 'vitest';
import { describeFailure, failureSchema, failureTiming } from './failure';

const site = (failed_on: string | null, components: { component_type: string; fitted_on: string; voided_at: string | null }[] = []) =>
  ({ failed_on, failure_type: 'removed', failure_reason: 'peri_implantitis', failure_notes: '', components }) as never;

describe('failure', () => {
  it('is early before the first abutment-level component, late from then on', () => {
    expect(failureTiming(site(null))).toBeNull();
    expect(failureTiming(site('2026-05-01'))).toBe('early');
    expect(failureTiming(site('2026-05-01', [{ component_type: 'healing_abutment', fitted_on: '2026-03-01', voided_at: null }]))).toBe('early');
    expect(failureTiming(site('2026-05-01', [{ component_type: 'ti_base', fitted_on: '2026-04-01', voided_at: null }]))).toBe('late');
    expect(failureTiming(site('2026-05-01', [{ component_type: 'abutment', fitted_on: '2026-04-01', voided_at: '2026-04-02T00:00:00Z' }]))).toBe('early');
    expect(failureTiming(site('2026-05-01', [{ component_type: 'final_restoration', fitted_on: '2026-05-01', voided_at: null }]))).toBe('late');
  });
  it('describes a failure', () => {
    expect(describeFailure(site('2026-05-01'))).toMatch(/^Removed · Peri-implantitis · .+ · early$/);
  });
  it('parses the failure form', () => {
    const ids = { siteId: '00000000-0000-4000-8000-000000000001', patientId: '00000000-0000-4000-8000-000000000002' };
    expect(failureSchema.parse({ ...ids, expectedUpdatedAt: '', failedOn: '2026-05-01', failureType: 'lost', failureReason: 'fracture', failureNotes: '' }))
      .toEqual({ ...ids, expectedUpdatedAt: null, failedOn: '2026-05-01', failureType: 'lost', failureReason: 'fracture', failureNotes: '' });
    expect(failureSchema.safeParse({ ...ids, failedOn: '2026-05-01', failureType: '', failureReason: 'fracture' }).error?.issues[0].message)
      .toBe('Choose the failure type.');
  });
});
