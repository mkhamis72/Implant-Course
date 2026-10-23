import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('./actions', () => ({ recordConsent: vi.fn(), voidConsent: vi.fn() }));
import { ConsentList } from './consent-list';
import type { ConsentRecord } from '@/lib/consent/labels';

const record = (over: Partial<ConsentRecord>): ConsentRecord => ({
  id: 'c1', version_id: 'v1', version_label: 'v1', language: 'en', signed_on: '2026-10-20', treatment: true, research: false,
  teaching_images: true, follow_up: true, file_id: 'f1', recorded_by_name: 'Org', created_at: '2026-10-20T10:00:00Z',
  voided_at: null, voided_by_name: null, voided_reason: null, is_current: false, ...over,
});

describe('ConsentList', () => {
  it('shows the current answers and links its scan to the file route in a new tab', () => {
    render(<ConsentList patientId="p1" editable={false} records={[record({ is_current: true })]} />);
    const card = screen.getByTestId('current-consent');
    expect(within(card).getAllByText('Yes')).toHaveLength(3);
    expect(within(card).getByText('No')).toHaveClass('badge-warn');
    const link = within(card).getByRole('link', { name: /View signed form/ });
    expect(link).toHaveAttribute('href', '/patients/p1/consent/file/f1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.queryByRole('button', { name: 'Void' })).toBeNull();
  });

  it('strikes through voided records in the history', () => {
    render(<ConsentList patientId="p1" editable records={[
      record({ id: 'c2', is_current: true, file_id: 'f2' }),
      record({ id: 'c1', voided_at: '2026-10-21T10:00:00Z', voided_reason: 'Wrong patient' }),
    ]} />);
    const row = screen.getByTestId('consent-history-row');
    expect(within(row).getByText('v1')).toHaveClass('line-through');
    expect(within(row).getByText(/Wrong patient/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Void' })).toHaveLength(1);
  });

  it('says when there is no current record', () => {
    render(<ConsentList patientId="p1" editable records={[]} />);
    expect(screen.getByText('No current consent record.')).toBeInTheDocument();
  });
});
