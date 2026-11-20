import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import { CLINIC_CONSENT_TEMPLATE } from '@/lib/consent/clinic-template';

const { rpc, requireAdmin } = vi.hoisted(() => ({ rpc: vi.fn(), requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ requireAdmin }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ rpc })) }));
vi.mock('./actions', () => ({ saveConsentVersion: vi.fn() }));
vi.mock('@/lib/branding/get', () => ({ getBranding: vi.fn() }));
import ConsentSettingsPage from './page';
import BlankConsentPrintPage from './print/page';

beforeEach(() => vi.clearAllMocks());

describe('Consent settings', () => {
  it("non-admins can't open the settings or the blank form: nothing is read", async () => {
    requireAdmin.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(ConsentSettingsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_REDIRECT');
    await expect(BlankConsentPrintPage({ searchParams: Promise.resolve({ lang: 'en' }) })).rejects.toThrow('NEXT_REDIRECT');
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('Consent settings: clinic template', () => {
  const version = { id: 'v1', label: 'v1', effective_on: '2026-10-01', text_en: 'Course text', text_ar: 'نص', in_use: true };
  const show = async (features: string[], template?: string) => {
    requireAdmin.mockResolvedValue({ role: 'admin', active: true, features });
    rpc.mockImplementation((name: string) => name === 'consent_versions'
      ? Promise.resolve({ data: [version], error: null })
      : { maybeSingle: () => Promise.resolve({ data: { id: 'v1' }, error: null }) });
    render(await ConsentSettingsPage({ searchParams: Promise.resolve(template ? { template } : {}) }));
    return within(screen.getByRole('region', { name: 'Add a new version' }));
  };

  it('a clinic has the template link; following it pre-fills label, English and Arabic', async () => {
    const add = await show(['inventory']);
    expect(add.getByRole('link', { name: 'New version from the clinic template' }))
      .toHaveAttribute('href', '/admin/settings/consent?template=clinic');
    expect(add.getByRole('textbox', { name: 'English text' })).toHaveValue('Course text');
    cleanup();

    const filled = await show(['inventory'], 'clinic');
    expect(filled.getByRole('textbox', { name: 'Label' })).toHaveValue(CLINIC_CONSENT_TEMPLATE.label);
    expect(filled.getByRole('textbox', { name: 'English text' })).toHaveValue(CLINIC_CONSENT_TEMPLATE.text_en);
    expect(filled.getByRole('textbox', { name: 'Arabic text' })).toHaveValue(CLINIC_CONSENT_TEMPLATE.text_ar);
    expect(filled.getByText(/Draft text: have it reviewed/)).toBeInTheDocument();
  });

  it('a course organizer has no template link, and the parameter is ignored', async () => {
    const add = await show(['teaching', 'inventory'], 'clinic');
    expect(add.queryByRole('link', { name: 'New version from the clinic template' })).toBeNull();
    expect(add.getByRole('textbox', { name: 'Label' })).toHaveValue('');
    expect(add.getByRole('textbox', { name: 'English text' })).toHaveValue('Course text');
  });
});
