import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FullArch } from './full-arch';
import { FullArchLegend } from './legend';
import type { ArchBridge, ArchImplant } from './model';

function implant(over: Partial<ArchImplant> & Pick<ArchImplant, 'tooth' | 'jaw'>): ArchImplant {
  return {
    siteId: `site-${over.tooth}`, kind: 'conventional', planned: false, failed: false, angle: 0, lean: 0,
    label: undefined, badge: undefined, description: `Implant ${over.tooth}, Conventional, placed`, ...over,
  };
}

const IMPLANTS: ArchImplant[] = [
  implant({ tooth: 14, jaw: 'upper', kind: 'zygomatic', angle: 45, lean: -1, label: 'ZYG', badge: 'MUA',
    description: 'Implant 14, Zygomatic, 45° distal, placed' }),
  implant({ tooth: 15, jaw: 'upper', badge: 'MUA' }),
  implant({ tooth: 36, jaw: 'lower', kind: 'tilted', angle: 30, lean: -1, label: 'TLT', description: 'Implant 36, Tilted, 30° distal, placed' }),
  implant({ tooth: 46, jaw: 'lower', planned: true, description: 'Implant 46, Conventional, planned' }),
];
const BRIDGES: ArchBridge[] = [
  { id: 'r1', teeth: [16, 15, 14, 13], implantTeeth: [15, 14], temporary: false, label: 'Bridge' },
];

describe('<FullArch>', () => {
  it('renders empty arches', () => {
    render(<FullArch model={{ implants: [], bridges: [] }} selected={[]} onSelect={vi.fn()} />);
    expect(screen.getByRole('img', { name: 'Full-arch chart' })).toBeInTheDocument();
    expect(screen.getByText('Schematic drawing — not a substitute for CBCT or 3D planning.')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText('48')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('implants are buttons named by description', () => {
    render(<FullArch model={{ implants: IMPLANTS, bridges: [] }} selected={[]} onSelect={vi.fn()} />);
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(screen.getByRole('button', { name: /Implant 14, Zygomatic/ })).toBeInTheDocument();
  });

  it('bridge click opens the restoration tab', () => {
    const onSelect = vi.fn();
    render(<FullArch model={{ implants: IMPLANTS, bridges: BRIDGES }} selected={[]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /final/ }));
    expect(onSelect).toHaveBeenCalledWith(15, false, 'restoration');
  });

  it('names a temporary bridge', () => {
    render(<FullArch model={{ implants: [], bridges: [{ ...BRIDGES[0], temporary: true }] }} selected={[]} onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Bridge, temporary' })).toHaveAttribute('data-temporary', 'true');
  });

  it('implant click and shift-click', () => {
    const onSelect = vi.fn();
    render(<FullArch model={{ implants: IMPLANTS, bridges: [] }} selected={[]} onSelect={onSelect} />);
    const button = screen.getByRole('button', { name: /Implant 36/ });
    fireEvent.click(button);
    expect(onSelect).toHaveBeenLastCalledWith(36, false);
    fireEvent.click(button, { shiftKey: true });
    expect(onSelect).toHaveBeenLastCalledWith(36, true);
    button.focus();
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith(36, false);
    expect(onSelect).toHaveBeenCalledTimes(3);
  });

  it('planned and failed are marked', () => {
    const failed = implant({ tooth: 26, jaw: 'upper', failed: true, description: 'Implant 26, Conventional, failed' });
    render(<FullArch model={{ implants: [...IMPLANTS, failed], bridges: [] }} selected={[]} onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Implant 46/ })).toHaveAttribute('data-planned', 'true');
    expect(screen.getByRole('button', { name: /Implant 26/ })).toHaveAttribute('data-failed', 'true');
    expect(screen.getByRole('button', { name: /Implant 36/ })).not.toHaveAttribute('data-planned', 'true');
  });

  it('selected implant is marked', () => {
    render(<FullArch model={{ implants: IMPLANTS, bridges: [] }} selected={[36]} onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Implant 36/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Implant 46/ })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('<FullArchLegend>', () => {
  it('lists the drawing’s marks', () => {
    render(<FullArchLegend />);
    for (const label of ['Planned implant', 'Placed implant', 'Failed implant', 'Temporary bridge', 'Final bridge']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
