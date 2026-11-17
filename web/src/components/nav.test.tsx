import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('@/app/actions/auth', () => ({ signOut: vi.fn() }));
import { Nav } from './nav';

const brand = { name: 'Academy', logoUrl: null };
const show = (features: ('inventory' | 'statistics' | 'teaching')[]) =>
  render(<Nav role="admin" permissions={{}} features={features} name="A" brand={brand} />);

describe('Nav', () => {
  it('has no Statistics link when the company lacks the statistics module', () => {
    show(['inventory', 'teaching']);
    expect(screen.queryByRole('link', { name: 'Statistics' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Inventory' })).toBeTruthy();
  });
  it('has the Statistics link with full features', () => {
    show(['inventory', 'statistics', 'teaching']);
    expect(screen.getByRole('link', { name: 'Statistics' })).toBeTruthy();
  });
});
