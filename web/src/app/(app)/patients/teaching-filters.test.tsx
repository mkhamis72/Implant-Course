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

  it('shows each is / is not switch at the URL value and submits it', async () => {
    const { container } = render(<form><TeachingFilters teachingOn {...props} courseNot /></form>);
    const mode = screen.getByRole('combobox', { name: 'Course filter mode' });
    expect(mode).toHaveValue('1');
    expect(screen.getByRole('combobox', { name: 'Supervisor filter mode' })).toHaveValue('');
    const data = new FormData(container.querySelector('form') as HTMLFormElement);
    expect(data.get('course_not')).toBe('1');
    expect(data.get('supervisor_not')).toBe('');
  });

  it('a clinic gets no course or supervisor filter', () => {
    const { container } = render(<TeachingFilters teachingOn={false} {...props} />);
    expect(container).toBeEmptyDOMElement();
  });
});
