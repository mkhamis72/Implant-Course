import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('./actions', () => ({ saveStudy: vi.fn(), deleteStudy: vi.fn() }));
import { StudyList } from './study-list';
import { deleteStudy } from './actions';
import type { StudyRow } from '@/lib/research/studies';

const study = (over: Partial<StudyRow> = {}): StudyRow => ({
  id: 's1', title: 'Short implants RCT', committee: 'Cairo University REC', approval_number: 'REC-2026-17',
  approval_date: '2026-09-01', protocol_name: 'Short implants', protocol_version: '2.1', protocol_date: '2026-08-15',
  notes: 'Recruiting from the spring course', has_letter: true, on_export: false,
  courses: [{ id: 'c1', name: 'Spring course', start_date: '2026-03-01' }], ...over,
});
const courses = [{ id: 'c1', name: 'Spring course' }, { id: 'c2', name: 'Autumn course' }];

beforeEach(() => vi.mocked(deleteStudy).mockReset().mockResolvedValue({}));

describe('StudyList', () => {
  it('shows a study with its approval, protocol, courses and letter', () => {
    render(<StudyList studies={[study()]} courses={courses} editable={false} isAdmin={false} />);
    const card = screen.getByTestId('study-s1');
    expect(within(card).getByRole('heading', { name: 'Short implants RCT' })).toBeInTheDocument();
    expect(card).toHaveTextContent('Cairo University REC');
    expect(card).toHaveTextContent('REC-2026-17');
    expect(card).toHaveTextContent('2.1');
    expect(card).toHaveTextContent('Spring course');
    expect(card).toHaveTextContent('Recruiting from the spring course');
    expect(within(card).getByRole('link', { name: /Approval letter/ })).toHaveAttribute('href', '/statistics/studies/s1/letter');
  });

  it('hides every edit control from View users', () => {
    render(<StudyList studies={[study()]} courses={courses} editable={false} isAdmin={false} />);
    expect(screen.queryByRole('button', { name: /Add study/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('lets editors add and edit, but only admins delete', () => {
    const { unmount } = render(<StudyList studies={[study()]} courses={courses} editable isAdmin={false} />);
    expect(screen.getByRole('button', { name: /Add study/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect((screen.getByRole('textbox', { name: /Title/ }) as HTMLInputElement).value).toBe('Short implants RCT');
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    unmount();
    render(<StudyList studies={[study()]} courses={courses} editable isAdmin />);
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('offers no delete for a study named on an export', () => {
    render(<StudyList studies={[study({ on_export: true })]} courses={courses} editable isAdmin />);
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.getByTestId('study-s1')).toHaveTextContent('Named on an export');
  });

  it('says when there are no studies', () => {
    render(<StudyList studies={[]} courses={courses} editable={false} isAdmin={false} />);
    expect(screen.getByText('No studies yet.')).toBeInTheDocument();
  });
});
