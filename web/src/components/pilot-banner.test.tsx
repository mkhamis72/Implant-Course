import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PilotBanner } from './pilot-banner';
import { PILOT_MESSAGE } from '@/lib/flags';

describe('<PilotBanner>', () => {
  it('shows the pilot rule only in pilot mode', () => {
    const { rerender } = render(<PilotBanner show />);
    expect(screen.getByRole('note')).toHaveTextContent(PILOT_MESSAGE);
    rerender(<PilotBanner show={false} />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});
