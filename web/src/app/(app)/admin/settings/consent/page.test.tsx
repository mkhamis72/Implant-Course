import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    await expect(ConsentSettingsPage()).rejects.toThrow('NEXT_REDIRECT');
    await expect(BlankConsentPrintPage({ searchParams: Promise.resolve({ lang: 'en' }) })).rejects.toThrow('NEXT_REDIRECT');
    expect(rpc).not.toHaveBeenCalled();
  });
});
