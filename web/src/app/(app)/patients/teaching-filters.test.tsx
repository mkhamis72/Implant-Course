import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TeachingFilters } from './teaching-filters';

const props = {
  courses: [{ id: 'c1', name: 'June course' }], supervisors: [{ id: 's1', label: 'Prof A' }], course: 'c1', supervisor: '',
};

describe('<TeachingFilters>', () => {
  it('a course organizer filters by course and supervisor', () => {
    render(<TeachingFilters teachingOn {...props} />);
    expect(screen.getByRole('combobox', { name: 'Course' })).toHaveValue('c1');
    expect(screen.getByRole('combobox', { name: 'Supervisor' })).toHaveValue('');
  });

  it('a clinic gets no course or supervisor filter', () => {
    const { container } = render(<TeachingFilters teachingOn={false} {...props} />);
    expect(container).toBeEmptyDOMElement();
  });
});
