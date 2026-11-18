import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScheduleTabs } from './schedule-tabs';

vi.mock('next/navigation', () => ({ usePathname: () => '/schedule', useSearchParams: () => new URLSearchParams() }));

describe('ScheduleTabs', () => {
  it('a course organizer has Surgery, Lectures and Workshops', () => {
    render(<ScheduleTabs teaching />);
    expect(screen.getByRole('link', { name: 'Lectures' })).toHaveAttribute('href', '/schedule/lectures');
    expect(screen.getByRole('link', { name: 'Workshops' })).toBeInTheDocument();
  });

  it('a clinic has no lectures or workshops, so no tabs', () => {
    render(<ScheduleTabs teaching={false} />);
    expect(screen.queryByRole('navigation', { name: 'Schedule sections' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Lectures' })).not.toBeInTheDocument();
  });
});
