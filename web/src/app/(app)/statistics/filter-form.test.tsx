import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FilterForm } from './filter-form';

const filters = { course: '', from: '', to: '', delegate: '', brand: '', system: '' };

describe('<FilterForm>', () => {
  it('keeps the compare choice when the filters are applied', () => {
    render(<FilterForm filters={{ ...filters, compare: 'smoking' }} courses={[]} delegates={[]} brands={[]} systems={[]} />);
    const hidden = screen.getByRole('form', { name: 'Filters' }).querySelector('input[type=hidden][name=compare]');
    expect(hidden).toHaveValue('smoking');
  });

  it('has no compare field without a comparison', () => {
    render(<FilterForm filters={filters} courses={[]} delegates={[]} brands={[]} systems={[]} />);
    expect(screen.getByRole('form', { name: 'Filters' }).querySelector('input[name=compare]')).toBeNull();
  });

  it('offers All courses as course=all, course first, and every filter visible', () => {
    render(<FilterForm filters={filters} courses={[{ id: 'c1', name: 'Spring' }]} delegates={[]} brands={[]} systems={[]} />);
    expect(screen.getByRole('option', { name: 'All courses' })).toHaveValue('all');
    const fields = [...screen.getByRole('form', { name: 'Filters' }).querySelectorAll('select, input:not([type=hidden])')].map((e) => e.getAttribute('name'));
    expect(fields).toEqual(['course', 'from', 'to', 'delegate', 'brand', 'system']);
  });
});
