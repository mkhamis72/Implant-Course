import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { BrandMark } from './brand-mark';

describe('BrandMark', () => {
  it('shows the company logo when there is one', () => {
    const { container } = render(<BrandMark logoUrl="/brand/logo?v=3" />);
    expect(container.querySelector('img')?.getAttribute('src')).toContain('/brand/logo?v=3');
    expect(container.querySelector('svg')).toBeNull();
  });
  it('falls back to today’s mark', () => {
    const { container } = render(<BrandMark logoUrl={null} />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});
