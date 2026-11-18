import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('./actions', () => ({
  onboardCompany: vi.fn(),
  addDomain: vi.fn(),
}));
vi.mock('server-only', () => ({}));
const vercel = { status: vi.fn() };
vi.mock('@/lib/console/vercel', () => ({ vercelConfigured: () => true, domainStatus: (h: string) => vercel.status(h) }));

import { CompaniesTable } from './companies-table';
import { RegisterForm } from './companies/new/register-form';
import { AddressPanel } from './companies/[slug]/address-panel';

describe('CompaniesTable', () => {
  it('shows one row per company', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ problems: [], users: 3, patients: 9 }), { status: 200 })));
    render(
      <CompaniesTable
        companies={[
          { slug: 'acme', name: 'Acme', hosts: ['acme.example.com'], status: 'active', kind: 'course_organizer' },
          { slug: 'beta', name: 'Beta', hosts: ['beta.example.com'], status: 'suspended', kind: 'clinic' },
        ]}
      />,
    );
    expect(screen.getByTestId('company-acme')).toBeTruthy();
    expect(screen.getByTestId('company-beta')).toBeTruthy();
    expect(await screen.findAllByText('OK')).toHaveLength(2);
  });

  it('shows each company type', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ problems: [], users: 0, patients: 0 }), { status: 200 })));
    render(
      <CompaniesTable
        companies={[
          { slug: 'acme', name: 'Acme', hosts: ['acme.example.com'], status: 'active', kind: 'course_organizer' },
          { slug: 'beta', name: 'Beta', hosts: ['beta.example.com'], status: 'active', kind: 'clinic' },
        ]}
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'Type' })).toBeTruthy();
    expect(within(screen.getByTestId('company-acme')).getByText('Course organizer')).toBeTruthy();
    expect(within(screen.getByTestId('company-beta')).getByText('Clinic')).toBeTruthy();
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

describe('AddressPanel', () => {
  it('says why Vercel could not be asked and still offers the retry', async () => {
    vercel.status.mockRejectedValueOnce(new Error('Vercel: You don’t have permission to access this team.'));
    render(await AddressPanel({ slug: 'demo', hosts: ['demo.imploid.net'] }));
    expect(screen.getByText(/You don’t have permission to access this team/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add demo.imploid.net to Vercel' })).toBeTruthy();
  });

  it('offers no retry for a live address', async () => {
    vercel.status.mockResolvedValueOnce('live');
    render(await AddressPanel({ slug: 'demo', hosts: ['demo.imploid.net'] }));
    expect(screen.getByText('Live')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
