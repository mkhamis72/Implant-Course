import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BrandingForm } from './branding-form';

vi.mock('./actions', () => ({ brandingAction: vi.fn() }));

const unbranded = { name: 'Implant Course Manager', brandColor: null, navColor: null, logoUrl: null };

describe('BrandingForm', () => {
  it('starts from today’s look: blank fields with the defaults as placeholders, no logo actions', () => {
    render(<BrandingForm branding={unbranded} />);
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('placeholder', 'Implant Course Manager');
    expect(screen.getByRole('textbox', { name: 'Brand colour' })).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Remove logo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeInTheDocument();
  });

  it('shows saved values and the current logo', () => {
    render(<BrandingForm branding={{ name: 'Acme Implants', brandColor: '#7c2d12', navColor: '#1e293b', logoUrl: '/brand/logo?v=2' }} />);
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Acme Implants');
    expect(screen.getByRole('textbox', { name: 'Navigation colour' })).toHaveValue('#1e293b');
    expect(screen.getByRole('img', { name: 'Current logo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove logo' })).toBeInTheDocument();
  });

  it('warns while typing a colour that is too light or unreadable', () => {
    render(<BrandingForm branding={unbranded} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Brand colour' }), { target: { value: '#fde68a' } });
    expect(screen.getByText('This colour is too light to read on white. Choose a darker shade.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Navigation colour' }), { target: { value: '777777' } });
    expect(screen.getByText("Text can't be read on this navigation colour. Choose a lighter or darker shade.")).toBeInTheDocument();
  });

  it('refuses a logo over 200 KB before uploading it', () => {
    render(<BrandingForm branding={unbranded} />);
    const input = screen.getByLabelText(/Logo/) as HTMLInputElement;
    const big = new File([new Uint8Array(204801)], 'photo.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [big] } });
    expect(screen.getByRole('alert')).toHaveTextContent('The logo must be 200 KB or smaller.');
    expect(input.value).toBe('');
  });

  it('follows new saved colours (for example after a reset) without remounting', () => {
    const saved = { name: 'Acme Implants', brandColor: '#7c2d12', navColor: '#1e293b', logoUrl: null };
    const { rerender } = render(<BrandingForm branding={saved} />);
    expect(screen.getByRole('textbox', { name: 'Brand colour' })).toHaveValue('#7c2d12');
    rerender(<BrandingForm branding={unbranded} />);
    expect(screen.getByRole('textbox', { name: 'Brand colour' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Navigation colour' })).toHaveValue('');
  });
  it('submits through one action: the buttons carry the save, remove and reset intents', () => {
    const { unmount } = render(<BrandingForm branding={unbranded} />);
    expect(screen.getByRole('button', { name: 'Save branding' })).toHaveAttribute('name', 'intent');
    expect(screen.getByRole('button', { name: 'Save branding' })).toHaveAttribute('value', 'save');
    expect(screen.getByRole('button', { name: 'Reset to defaults' })).toHaveAttribute('value', 'reset');
    expect(screen.queryByRole('button', { name: 'Remove logo' })).not.toBeInTheDocument();
    unmount();
    render(<BrandingForm branding={{ ...unbranded, logoUrl: '/brand/logo?v=1' }} />);
    expect(screen.getByRole('button', { name: 'Remove logo' })).toHaveAttribute('name', 'intent');
    expect(screen.getByRole('button', { name: 'Remove logo' })).toHaveAttribute('value', 'remove');
  });

  it('shows only one alert at a time', () => {
    render(<BrandingForm branding={unbranded} />);
    const big = new File([new Uint8Array(204801)], 'photo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText(/Logo/), { target: { files: [big] } });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
});
