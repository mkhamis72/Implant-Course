import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { YourPlan } from './your-plan';

const row = (name: string) => screen.queryByText(name)?.closest('tr') ?? null;

describe('YourPlan', () => {
  it('lists every part as included on the Full plan', () => {
    render(<YourPlan plan={{ kind: 'course_organizer', name: 'Full' }} features={['inventory', 'statistics', 'teaching']} />);
    expect(screen.getByRole('heading', { name: /Your plan/ })).toBeInTheDocument();
    expect(screen.getByText('Plan: Full')).toBeInTheDocument();
    for (const name of ['Patients, Schedule, Checklists, Dashboard and Admin', 'Courses and delegates', 'Inventory', 'Statistics']) {
      expect(within(row(name)!).getByText('Included')).toBeInTheDocument();
    }
  });

  it('marks a missing module', () => {
    render(<YourPlan plan={{ kind: 'course_organizer', name: 'Basic' }} features={['inventory', 'teaching']} />);
    expect(within(row('Statistics')!).getByText('Not in your plan – contact us')).toBeInTheDocument();
  });

  it('has no Courses and delegates row for a clinic', () => {
    render(<YourPlan plan={{ kind: 'clinic', name: 'Clinic' }} features={['inventory', 'statistics']} />);
    expect(screen.queryByText('Courses and delegates')).toBeNull();
  });

  it('shows the rows without a plan name when the plan is unknown', () => {
    render(<YourPlan plan={null} features={[]} />);
    expect(screen.queryByText(/^Plan:/)).toBeNull();
    expect(row('Inventory')).not.toBeNull();
  });
});
