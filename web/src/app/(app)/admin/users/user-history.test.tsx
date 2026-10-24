import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UserHistory } from './user-history';

describe('UserHistory', () => {
  it('lists labels newest first as given', () => {
    render(
      <UserHistory
        entries={[
          { at: '2026-10-23T08:00:00Z', actor_name: 'Dr Admin', kind: 'mfa_reset' },
          { at: '2026-10-22T08:00:00Z', actor_name: null, kind: 'name_changed' },
        ]}
      />,
    );
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '2FA reset by Dr Admin · 23 Oct 2026',
      'Name changed · 22 Oct 2026',
    ]);
  });

  it('says when there is nothing', () => {
    render(<UserHistory entries={[]} />);
    expect(screen.getByText('No changes recorded.')).toBeInTheDocument();
  });
});
