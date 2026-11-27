import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { rpc, requireAdmin } = vi.hoisted(() => ({ rpc: vi.fn(), requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ requireAdmin }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ rpc })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/tenant/current', () => ({ currentTenant: vi.fn() }));
import { savePassportSettings } from './actions';
import { PassportSettingsForm } from './passport-form';

const form = (medical?: string) => {
  const f = new FormData();
  if (medical) f.set('medical', medical);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ role: 'admin' });
  rpc.mockResolvedValue({ data: null, error: null });
});

describe('savePassportSettings', () => {
  it('saves the choice through set_passport_settings', async () => {
    expect(await savePassportSettings({}, form('none'))).toEqual({ ok: 'Passport settings saved.' });
    expect(rpc).toHaveBeenCalledWith('set_passport_settings', { p_medical: 'none' });
  });

  it('refuses an unknown or missing choice without calling the database', async () => {
    for (const f of [form('everything'), form()]) {
      expect((await savePassportSettings({}, f)).error).toBe('Choose what medical content the passport prints.');
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it('is admin only', async () => {
    requireAdmin.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(savePassportSettings({}, form('full'))).rejects.toThrow('NEXT_REDIRECT');
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows the database's refusal", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Only an admin can change the passport settings.', hint: 'user' } });
    expect(await savePassportSettings({}, form('full'))).toEqual({ error: 'Only an admin can change the passport settings.' });
  });
});

describe('PassportSettingsForm', () => {
  it('offers the three choices with the current one checked', () => {
    render(<PassportSettingsForm medical="full" />);
    const group = screen.getByRole('radiogroup', { name: 'Medical content' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Allergies and medications only' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Full medical summary' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Nothing medical' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Save passport settings' })).toBeEnabled();
  });
});
