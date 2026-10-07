import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('./actions', () => ({
  checkCompany: vi.fn().mockResolvedValue({ problems: [], users: 3, patients: 9 }),
  registerCompany: vi.fn(),
}));
vi.mock('server-only', () => ({}));

import { CompaniesTable } from './companies-table';
import { RegisterForm } from './companies/new/register-form';

describe('CompaniesTable', () => {
  it('shows one row per company', async () => {
    render(
      <CompaniesTable
        companies={[
          { slug: 'acme', name: 'Acme', hosts: ['acme.example.com'], status: 'active' },
          { slug: 'beta', name: 'Beta', hosts: ['beta.example.com'], status: 'suspended' },
        ]}
      />,
    );
    expect(screen.getByTestId('company-acme')).toBeTruthy();
    expect(screen.getByTestId('company-beta')).toBeTruthy();
    expect(await screen.findAllByText('OK')).toHaveLength(2);
  });
});

describe('RegisterForm', () => {
  it('never pre-fills the key fields', () => {
    render(<RegisterForm />);
    for (const label of ['Anon key', 'Service role key', 'Database URL (session pooler)']) {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      expect(input.type).toBe('password');
      expect(input.defaultValue).toBe('');
    }
  });
});
