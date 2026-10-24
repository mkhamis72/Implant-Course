import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExportForm, ExportLog } from './export-panel';
import type { ResearchFilters } from '@/lib/research/view';

const filters: ResearchFilters = { course: 'c1', from: '2025-01-01', to: '', delegate: '', brand: 'Oxy', system: '' };

describe('<ExportForm>', () => {
  it('is a GET form to the export route carrying the current filters', () => {
    render(<ExportForm filters={filters} />);
    const form = screen.getByRole('form', { name: 'Export' });
    expect(form).toHaveAttribute('action', '/statistics/export');
    expect(form).toHaveAttribute('method', 'get');
    const hidden = Array.from(form.querySelectorAll('input[type=hidden]')).map((i) => [(i as HTMLInputElement).name, (i as HTMLInputElement).value]);
    expect(hidden).toEqual([['course', 'c1'], ['from', '2025-01-01'], ['brand', 'Oxy']]);
    expect(screen.getByRole('radio', { name: /Excel/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /CSV/ })).not.toBeChecked();
  });
  it('offers an optional study (blank = none) as a visible select', () => {
    render(<ExportForm filters={filters} studies={[{ id: 's1', title: 'Short implants RCT' }, { id: 's2', title: 'Sinus lift' }]} />);
    const select = screen.getByRole('combobox', { name: 'Study' }) as HTMLSelectElement;
    expect(select.name).toBe('study');
    expect(select.value).toBe('');
    expect(Array.from(select.options).map((o) => [o.value, o.text])).toEqual([['', 'None'], ['s1', 'Short implants RCT'], ['s2', 'Sinus lift']]);
  });
  it('has no study select when there are no studies', () => {
    render(<ExportForm filters={filters} studies={[]} />);
    expect(screen.queryByRole('combobox', { name: 'Study' })).not.toBeInTheDocument();
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
  it('names the course and delegate filters instead of showing ids', () => {
    const course = '11111111-2222-4333-8444-555555555555';
    const delegate = '66666666-7777-4888-9999-aaaaaaaaaaaa';
    const gone = '99999999-7777-4888-9999-aaaaaaaaaaaa';
    render(<ExportLog isAdmin rows={[
      { ...rows[0], filters: { course, delegate, brand: 'Oxy' } },
      { ...rows[0], id: '2', filters: { course: gone } },
    ]} courseNames={{ [course]: 'Spring course' }} delegateNames={{ [delegate]: 'Dr Bob' }} />);
    expect(screen.getByText('course Spring course, delegate Dr Bob, brand Oxy')).toBeInTheDocument();
    expect(screen.getByText('course (deleted)')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });
  it('names the study by title', () => {
    const study = '0f0f0f0f-1111-4222-8333-444444444444';
    render(<ExportLog isAdmin rows={[{ ...rows[0], filters: { brand: 'Oxy', study } }, { ...rows[0], id: '2', filters: { study: 'gone' } }]} studyTitles={{ [study]: 'Short implants RCT' }} />);
    expect(screen.getByText('brand Oxy, study Short implants RCT')).toBeInTheDocument();
    expect(screen.getByText('study (deleted)')).toBeInTheDocument();
  });
  it('says the log could not be loaded instead of "No exports yet"', () => {
    render(<ExportLog isAdmin rows={[]} failed />);
    expect(screen.getByText('Could not load exports.')).toBeInTheDocument();
    expect(screen.queryByText('No exports yet.')).not.toBeInTheDocument();
  });
  it('shows nothing to others', () => {
    const { container } = render(<ExportLog isAdmin={false} rows={rows} />);
    expect(container).toBeEmptyDOMElement();
  });
});
