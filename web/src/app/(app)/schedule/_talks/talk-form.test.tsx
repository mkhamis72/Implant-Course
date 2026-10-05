import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TalkForm } from './talk-form';
import { createTalk } from './actions';

vi.mock('./actions', () => ({ createTalk: vi.fn(), updateTalk: vi.fn(), deleteTalk: vi.fn() }));

const base = { kind: 'lectures' as const, lecturers: [{ id: 'l1', label: 'Prof One' }] };
const initial = { sessionId: 's1', start: '09:00', end: '10:00', lecturerId: '', topic: '', notes: '' };

describe('TalkForm', () => {
  it('offers sessions when adding', () => {
    render(<TalkForm {...base} sessions={[{ id: 's1', label: '02 Mar 2030 · Course · Morning' }]} initial={initial} />);
    expect(screen.getByRole('combobox', { name: 'Session' })).toHaveValue('s1');
    expect(screen.getByRole('combobox', { name: 'Lecturer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save talk' })).toBeInTheDocument();
  });
  it('shows the session as text when editing', () => {
    render(<TalkForm {...base} sessionLabel="02 Mar 2030 · Course · Morning" initial={{ ...initial, talkId: 't1', topic: 'Flaps' }} />);
    expect(screen.queryByRole('combobox', { name: 'Session' })).toBeNull();
    expect(screen.getByText('02 Mar 2030 · Course · Morning')).toBeInTheDocument();
    expect(screen.getByLabelText('Topic')).toHaveValue('Flaps');
  });
  it('keeps every choice after a refused save', async () => {
    const user = userEvent.setup();
    vi.mocked(createTalk).mockImplementation(async (_prev, fd) => ({
      error: 'Another talk in this session overlaps (09:00–10:00, Flaps).',
      values: Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)])),
    }));
    render(<TalkForm {...base} sessions={[{ id: 's1', label: 'Morning' }, { id: 's2', label: 'Afternoon' }]} initial={initial} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Session' }), 's2');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Lecturer' }), 'l1');
    await user.type(screen.getByLabelText('Topic'), 'Flap design');
    await user.click(screen.getByRole('button', { name: 'Save talk' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Another talk in this session overlaps');
    expect(screen.getByRole('combobox', { name: 'Session' })).toHaveValue('s2');
    expect(screen.getByRole('combobox', { name: 'Lecturer' })).toHaveValue('l1');
    expect(screen.getByLabelText('Topic')).toHaveValue('Flap design');
  });
  it('points to Admin → Lecturers when the list is empty', () => {
    render(<TalkForm kind="workshops" lecturers={[]} sessions={[]} initial={initial} />);
    expect(screen.getByText(/No lecturers yet/)).toBeInTheDocument();
  });
});
