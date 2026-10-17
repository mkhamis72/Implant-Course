import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Odontogram } from './odontogram';
import { Legend } from './legend';

describe('<Odontogram>', () => {
  it('renders all 32 teeth as buttons, present by default', () => {
    render(<Odontogram statuses={{}} selected={[]} onSelect={vi.fn()} />);
    const teeth = screen.getAllByRole('button', { name: /^Tooth \d\d, / });
    expect(teeth).toHaveLength(32);
    expect(screen.getByRole('button', { name: 'Tooth 36, Present' })).toBeInTheDocument();
  });

  it('shows each tooth’s status', () => {
    render(<Odontogram statuses={{ 36: 'missing', 46: 'implant_placed' }} selected={[]} onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Tooth 36, Missing' })).toHaveAttribute('data-status', 'missing');
    const implant = screen.getByRole('button', { name: 'Tooth 46, Implant placed' });
    expect(implant.querySelector('[data-glyph="fixture"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Tooth 36, Missing' }).querySelector('[data-glyph="fixture"]')).toBeNull();
  });

  it('marks selected teeth as pressed', () => {
    render(<Odontogram statuses={{}} selected={[36]} onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Tooth 36, Present' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Tooth 46, Present' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('selects with click, shift/ctrl-click (additive) and the keyboard', () => {
    const onSelect = vi.fn();
    render(<Odontogram statuses={{}} selected={[]} onSelect={onSelect} />);
    const tooth = screen.getByRole('button', { name: 'Tooth 36, Present' });
    fireEvent.click(tooth);
    fireEvent.click(tooth, { shiftKey: true });
    fireEvent.click(tooth, { ctrlKey: true });
    fireEvent.keyDown(tooth, { key: 'Enter' });
    fireEvent.keyDown(tooth, { key: ' ', shiftKey: true });
    fireEvent.keyDown(tooth, { key: 'a' });
    expect(onSelect.mock.calls).toEqual([
      [36, false],
      [36, true],
      [36, true],
      [36, false],
      [36, true],
    ]);
  });
});

describe('<Legend>', () => {
  it('explains every status', () => {
    render(<Legend />);
    for (const label of ['Present', 'Missing', 'To be extracted', 'Implant planned', 'Implant placed', 'Restored', 'Failed implant']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});

describe('<Odontogram> badges', () => {
  it('shows the current component badge and announces it', () => {
    render(<Odontogram statuses={{ 36: 'implant_placed' }} badges={{ 36: 'TB' }} selected={[]} onSelect={vi.fn()} />);
    const tooth = screen.getByRole('button', { name: 'Tooth 36, Implant placed, TB' });
    expect(tooth.querySelector('[data-badge]')?.textContent).toBe('TB');
    expect(screen.getByRole('button', { name: 'Tooth 46, Present' }).querySelector('[data-badge]')).toBeNull();
  });
});

describe('<Odontogram> alerts', () => {
  it('marks a tooth with an open complication, in its name and with a marker', () => {
    const { container } = render(<Odontogram statuses={{ 46: 'implant_placed' }} selected={[]} onSelect={vi.fn()} alerts={{ 46: true }} />);
    expect(screen.getByRole('button', { name: 'Tooth 46, Implant placed, open complication' })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-alert]')).toHaveLength(1);
  });
});
