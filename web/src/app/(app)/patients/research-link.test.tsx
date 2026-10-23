import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResearchLink } from './research-link';

describe('<ResearchLink>', () => {
  it('shows for admins and organizers with Research view', () => {
    const { unmount } = render(<ResearchLink profile={{ role: 'admin', permissions: {} }} />);
    expect(screen.getByRole('link', { name: 'Research' })).toHaveAttribute('href', '/patients/research');
    unmount();
    render(<ResearchLink profile={{ role: 'organizer', permissions: { patients: 'view', research: 'view' } }} />);
    expect(screen.getByRole('link', { name: 'Research' })).toBeInTheDocument();
  });

  it('is hidden without Research view', () => {
    render(<ResearchLink profile={{ role: 'organizer', permissions: { patients: 'edit' } }} />);
    expect(screen.queryByRole('link', { name: 'Research' })).toBeNull();
  });
});
