import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DateProblemBadge } from './date-problem-badge';

describe('DateProblemBadge', () => {
  it('renders nothing without issues', () => {
    const { container } = render(<DateProblemBadge count={0} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('shows the text, with the count above one', () => {
    const { rerender } = render(<DateProblemBadge count={1} />);
    expect(screen.getByText('Date problem')).toHaveClass('badge-warn');
    rerender(<DateProblemBadge count={3} />);
    expect(screen.getByText('Date problem (3)')).toBeInTheDocument();
  });
});
