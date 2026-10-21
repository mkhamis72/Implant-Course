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

describe('<Odontogram> restorations', () => {
  const bridge = { id: 'r1', teeth: [34, 35, 36], implantTeeth: [34, 36], label: 'Bridge 34–36', temporary: false };

  it('draws one bar per restoration, labelled, and outlines pontics dashed', () => {
    const { container } = render(
      <Odontogram statuses={{ 34: 'restored', 36: 'restored' }} spans={[bridge]} selected={[]} onSelect={vi.fn()} />,
    );
    expect(screen.getAllByRole('button', { name: /^Bridge/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Bridge 34–36' }).textContent).toBe('Bridge 34–36');
    expect(container.querySelectorAll('[data-span]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Tooth 35, / })).toHaveAttribute('data-covered', 'pontic');
    expect(screen.getByRole('button', { name: /^Tooth 34, / })).toHaveAttribute('data-covered', 'implant');
    expect(screen.getByRole('button', { name: /^Tooth 37, / })).not.toHaveAttribute('data-covered');
  });

  it('draws a temporary lighter and says so', () => {
    render(<Odontogram statuses={{}} spans={[{ ...bridge, temporary: true }, { ...bridge, id: 'r2', teeth: [46], implantTeeth: [46], label: 'Crown' }]} selected={[]} onSelect={vi.fn()} />);
    const temp = screen.getByRole('button', { name: 'Bridge 34–36, temporary' });
    const final = screen.getByRole('button', { name: 'Crown' });
    // Only the bar is lighter; the label keeps full contrast.
    expect(temp).not.toHaveAttribute('opacity');
    expect(temp.querySelector('rect')!.style.fill).toBe('var(--color-accent-soft)');
    expect(temp.querySelector('text')!.style.fill).toBe('var(--color-accent-strong)');
    expect(final.querySelector('rect')!.style.fill).toBe('var(--color-accent)');
  });

  it('a bar or a pontic opens the first implant on its Restoration tab; shift-click still selects the pontic', () => {
    const onSelect = vi.fn();
    render(<Odontogram statuses={{}} spans={[bridge]} selected={[]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /^Tooth 35, / }));
    fireEvent.click(screen.getByRole('button', { name: 'Bridge 34–36' }));
    fireEvent.click(screen.getByRole('button', { name: /^Tooth 36, / }));
    fireEvent.click(screen.getByRole('button', { name: /^Tooth 35, / }), { shiftKey: true });
    expect(onSelect.mock.calls).toEqual([
      [34, false, 'restoration'],
      [34, false, 'restoration'],
      [36, false, 'restoration'],
      [35, true],
    ]);
  });

  it('while its restoration is open, a covered tooth clicks like any tooth (a pontic selects itself)', () => {
    const onSelect = vi.fn();
    render(<Odontogram statuses={{}} spans={[bridge]} openSpan="r1" selected={[34]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /^Tooth 35, / }));
    fireEvent.keyDown(screen.getByRole('button', { name: /^Tooth 34, / }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Bridge 34–36' }));
    expect(onSelect.mock.calls).toEqual([[35, false], [34, false], [34, false, 'restoration']]);
  });
});
