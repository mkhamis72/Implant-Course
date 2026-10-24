import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('./actions', () => ({ saveStudy: vi.fn(), deleteStudy: vi.fn() }));
import { StudyForm } from './study-form';
import { saveStudy } from './actions';

const courses = [{ id: 'c1', name: 'Spring course' }, { id: 'c2', name: 'Autumn course' }];

beforeEach(() => vi.mocked(saveStudy).mockReset().mockResolvedValue({}));

const submit = () => fireEvent.submit(screen.getByRole('button', { name: /Save study/ }).closest('form')!);

describe('StudyForm', () => {
  it('requires the title', async () => {
    render(<StudyForm courses={courses} />);
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the study title.');
    expect(saveStudy).not.toHaveBeenCalled();
  });

  it('sends the fields, the ticked courses and the PDF letter untouched', async () => {
    const onDone = vi.fn();
    render(<StudyForm courses={courses} onDone={onDone} />);
    fireEvent.change(screen.getByRole('textbox', { name: /Title/ }), { target: { value: 'Short implants RCT' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Ethics committee/ }), { target: { value: 'Cairo REC' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Autumn course' }));
    const pdf = new File([new TextEncoder().encode('%PDF-1.7\n')], 'letter.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/Approval letter/), { target: { files: [pdf] } });
    submit();
    await waitFor(() => expect(saveStudy).toHaveBeenCalledTimes(1));
    const [id, fd] = vi.mocked(saveStudy).mock.calls[0];
    expect(id).toBeNull();
    expect(fd.get('title')).toBe('Short implants RCT');
    expect(fd.get('committee')).toBe('Cairo REC');
    expect(fd.getAll('courses')).toEqual(['c2']);
    expect((fd.get('letter') as File).name).toBe('letter.pdf');
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('edits an existing study, its courses preticked, and can remove the letter', async () => {
    render(<StudyForm courses={courses} study={{
      id: 's1', title: 'T', committee: null, approval_number: null, approval_date: null, protocol_name: null,
      protocol_version: null, protocol_date: null, notes: null, has_letter: true, on_export: false,
      courses: [{ id: 'c1', name: 'Spring course', start_date: '2026-03-01' }],
    }} />);
    expect(screen.getByRole('checkbox', { name: 'Spring course' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: /Remove the current letter/ }));
    submit();
    await waitFor(() => expect(saveStudy).toHaveBeenCalledTimes(1));
    const [id, fd] = vi.mocked(saveStudy).mock.calls[0];
    expect(id).toBe('s1');
    expect(fd.get('remove_letter')).toBe('on');
  });

  it('shows the server refusal', async () => {
    vi.mocked(saveStudy).mockResolvedValue({ error: "The approval date can't be in the future." });
    render(<StudyForm courses={courses} />);
    fireEvent.change(screen.getByRole('textbox', { name: /Title/ }), { target: { value: 'T' } });
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent("The approval date can't be in the future.");
  });

  it('edits the study it just saved when only the letter failed, so a retry adds no duplicate', async () => {
    vi.mocked(saveStudy).mockResolvedValueOnce({ error: 'The study was saved, but not the letter: x', savedId: 's9' });
    render(<StudyForm courses={courses} />);
    fireEvent.change(screen.getByRole('textbox', { name: /Title/ }), { target: { value: 'T' } });
    submit();
    await screen.findByRole('alert');
    // Under load the alert can render while the button still reads "Saving…".
    await screen.findByRole('button', { name: /Save study/ });
    submit();
    await waitFor(() => expect(saveStudy).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveStudy).mock.calls[0][0]).toBeNull();
    expect(vi.mocked(saveStudy).mock.calls[1][0]).toBe('s9');
  });
});
