import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Template } from '@/lib/checklists/types';

vi.mock('../actions', () => ({ saveTemplate: vi.fn(async () => ({ ok: 'Template saved.' })) }));
import { TemplateForm } from './template-form';

const template = {
  id: 't1', name: 'Booking prep', applies_to: 'surgery_booking', is_default: false, items: [{ text: 'Consent signed', position: 1 }],
} as Template;

describe('<TemplateForm>', () => {
  it('keeps the chosen "Used for" after saving', async () => {
    render(<TemplateForm template={template} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(screen.getByText('Template saved.')).toBeInTheDocument());
    expect(screen.getByRole('combobox', { name: 'Used for' })).toHaveValue('surgery_booking');
  });
});

describe('TemplateForm in a clinic', () => {
  it('reads Clinic day for the surgery scope and offers no lecture or workshop', () => {
    render(<TemplateForm teaching={false} />);
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toContain('Clinic day');
    expect(options).not.toContain('Surgery session');
    expect(options).not.toContain('Lecture');
    expect(options).not.toContain('Workshop');
  });
});
