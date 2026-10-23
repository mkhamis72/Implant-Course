import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConsentBadge } from './consent-badge';

describe('ConsentBadge', () => {
  it('shows "No consent on file" when there is no current record', () => {
    render(<ConsentBadge patientId="p1" hasCurrent={false} />);
    const badge = screen.getByText('No consent on file');
    expect(badge).toHaveClass('badge', 'badge-warn');
    expect(badge.closest('a')).toHaveAttribute('href', '/patients/p1/consent');
  });
  it('renders nothing with a current record', () => {
    const { container } = render(<ConsentBadge patientId="p1" hasCurrent />);
    expect(container).toBeEmptyDOMElement();
  });
});
