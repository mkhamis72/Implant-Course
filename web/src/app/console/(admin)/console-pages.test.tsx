import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('./actions', () => ({
  onboardCompany: vi.fn(),
}));
vi.mock('server-only', () => ({}));

import { CompaniesTable } from './companies-table';
import { RegisterForm } from './companies/new/register-form';

describe('CompaniesTable', () => {
  it('shows one row per company', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ problems: [], users: 3, patients: 9 }), { status: 200 })));
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
  it('asks for no keys, and suggests the slug and address from the name until they are edited', () => {
    render(<RegisterForm baseDomain="imploid.net" />);
    expect(screen.queryByLabelText(/key/i)).toBeNull();
    expect(screen.queryByLabelText(/Database URL/i)).toBeNull();
    const slug = screen.getByLabelText('Slug') as HTMLInputElement;
    const hosts = screen.getByLabelText('Address (one per line)') as HTMLTextAreaElement;
    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Delta Dental Centre' } });
    expect(slug.value).toBe('delta-dental-centre');
    expect(hosts.value).toBe('delta-dental-centre.imploid.net');
    fireEvent.change(slug, { target: { value: 'delta' } });
    expect(hosts.value).toBe('delta.imploid.net');
    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Delta Two' } });
    expect(slug.value).toBe('delta');
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Full name')).toBeTruthy();
  });
});
