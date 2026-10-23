import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExportForm, ExportLog } from './export-panel';
import type { ResearchFilters } from '@/lib/research/view';

const filters: ResearchFilters = { course: 'c1', from: '2025-01-01', to: '', delegate: '', brand: 'Oxy', system: '' };

describe('<ExportForm>', () => {
  it('is a GET form to the export route carrying the current filters', () => {
    render(<ExportForm filters={filters} />);
    const form = screen.getByRole('form', { name: 'Export' });
    expect(form).toHaveAttribute('action', '/patients/research/export');
    expect(form).toHaveAttribute('method', 'get');
    const hidden = Array.from(form.querySelectorAll('input[type=hidden]')).map((i) => [(i as HTMLInputElement).name, (i as HTMLInputElement).value]);
    expect(hidden).toEqual([['course', 'c1'], ['from', '2025-01-01'], ['brand', 'Oxy']]);
    expect(screen.getByRole('radio', { name: /Excel/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /CSV/ })).not.toBeChecked();
  });
});

describe('<ExportLog>', () => {
  const rows = [{ id: '1', exported_at: '2026-10-23T10:00:00Z', format: 'xlsx', filters: { brand: 'Oxy' }, row_counts: { implants: 5, patients: 4 }, exporter: 'Dr Ann' }];
  it('shows the recent exports to admins', () => {
    render(<ExportLog isAdmin rows={rows} />);
    expect(screen.getByRole('heading', { name: 'Recent exports' })).toBeInTheDocument();
    expect(screen.getByText('Dr Ann')).toBeInTheDocument();
    expect(screen.getByText(/implants 5/)).toBeInTheDocument();
  });
  it('shows nothing to others', () => {
    const { container } = render(<ExportLog isAdmin={false} rows={rows} />);
    expect(container).toBeEmptyDOMElement();
  });
});
