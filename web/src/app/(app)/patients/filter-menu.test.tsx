import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotSelect } from './filter-menu';

describe('<NotSelect>', () => {
  it('renders the URL value and submits stage_not=1 for is not', () => {
    const { container, rerender } = render(<form><NotSelect name="stage_not" label="Stage filter mode" value /></form>);
    expect(screen.getByRole('combobox', { name: 'Stage filter mode' })).toHaveValue('1');
    expect(new FormData(container.querySelector('form') as HTMLFormElement).get('stage_not')).toBe('1');
    rerender(<form><NotSelect name="stage_not" label="Stage filter mode" value={false} /></form>);
    expect(screen.getByRole('combobox', { name: 'Stage filter mode' })).toHaveValue('');
  });
});
