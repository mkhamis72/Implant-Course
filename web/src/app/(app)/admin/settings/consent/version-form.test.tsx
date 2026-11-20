import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VersionForm } from './version-form';
import { saveConsentVersion } from './actions';

vi.mock('./actions', () => ({ saveConsentVersion: vi.fn() }));

const LOCKED = "This form version has been signed by patients and can't be changed. Add a new version instead.";
const v = { id: '1b4e28ba-2fa1-41d2-883f-0016d3cca427', label: 'v1', effective_on: '2026-10-01', text_en: 'English', text_ar: 'عربي' };

describe('VersionForm', () => {
  it('shows a signed version locked: the message, disabled fields and no save button', () => {
    render(<VersionForm version={{ ...v, in_use: true }} />);
    expect(screen.getByText(LOCKED)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Label' })).toBeDisabled();
    expect(screen.getByLabelText('Effective from')).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'English text' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Arabic text' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Save/ })).not.toBeInTheDocument();
  });

  it('lets an unsigned version be edited', () => {
    render(<VersionForm version={{ ...v, in_use: false }} />);
    expect(screen.queryByText(LOCKED)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Label' })).toHaveValue('v1');
    expect(screen.getByRole('textbox', { name: 'Arabic text' })).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('adds a new version, starting from the given text', () => {
    render(<VersionForm start={{ text_en: 'English', text_ar: 'عربي' }} />);
    expect(screen.getByRole('textbox', { name: 'Label' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'English text' })).toHaveValue('English');
    expect(screen.getByRole('button', { name: 'Add version' })).toBeEnabled();
  });

  it('remounts the add form after a successful add', async () => {
    vi.mocked(saveConsentVersion).mockResolvedValue({ ok: 'Form version added.' });
    const { container } = render(<VersionForm start={{ text_en: 'English', text_ar: 'عربي' }} />);
    const before = container.querySelector('form');
    fireEvent.submit(before!);
    await screen.findByRole('status');
    await waitFor(() => expect(container.querySelector('form')).not.toBe(before));
  });

  it('marks an add started from a template, so the action can leave the template page', () => {
    const { container, unmount } = render(<VersionForm start={{ label: 'Draft — needs review', text_en: 'E', text_ar: 'ع' }} />);
    expect(container.querySelector('input[name="from_template"]')).toHaveValue('clinic');
    unmount();
    const plain = render(<VersionForm start={{ text_en: 'E', text_ar: 'ع' }} />);
    expect(plain.container.querySelector('input[name="from_template"]')).toBeNull();
  });

  it('shows the review banner while the label is the draft label, and not otherwise', () => {
    const banner = 'Draft text: have it reviewed by your legal adviser and a native Arabic speaker before patients sign it.';
    const { unmount } = render(<VersionForm start={{ label: 'Draft — needs review', text_en: 'English', text_ar: 'عربي' }} />);
    expect(screen.getByRole('textbox', { name: 'Label' })).toHaveValue('Draft — needs review');
    expect(screen.getByText(banner)).toBeInTheDocument();
    unmount();
    render(<VersionForm version={{ ...v, label: 'Draft — needs review', in_use: false }} />);
    expect(screen.getByText(banner)).toBeInTheDocument();
    render(<VersionForm version={{ ...v, in_use: false }} />);
    expect(screen.getAllByText(banner)).toHaveLength(1);
  });
});
