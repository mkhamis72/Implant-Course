import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rpc, requireAdmin } = vi.hoisted(() => ({ rpc: vi.fn(), requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ requireAdmin }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ rpc })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { saveConsentVersion } from './actions';

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ user_id: 'me' });
});

const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, val] of Object.entries(fields)) f.set(k, val);
  return f;
};
const fields = { label: ' v2 ', effective_on: '2026-11-01', text_en: 'English', text_ar: 'عربي' };

describe('saveConsentVersion', () => {
  it('adds a version through save_consent_version', async () => {
    rpc.mockResolvedValue({ data: id, error: null });
    expect(await saveConsentVersion({}, form(fields))).toEqual({ ok: 'Form version added.' });
    expect(rpc).toHaveBeenCalledWith('save_consent_version', {
      p_id: null, p_label: 'v2', p_effective_on: '2026-11-01', p_text_en: 'English', p_text_ar: 'عربي',
    });
  });

  it('edits a version by id', async () => {
    rpc.mockResolvedValue({ data: id, error: null });
    expect(await saveConsentVersion({}, form({ ...fields, id }))).toEqual({ ok: 'Form version saved.' });
    expect(rpc).toHaveBeenCalledWith('save_consent_version', expect.objectContaining({ p_id: id }));
  });

  it("shows the database's refusal and keeps the typed values", async () => {
    const locked = "This form version has been signed by patients and can't be changed. Add a new version instead.";
    rpc.mockResolvedValue({ data: null, error: { message: locked, hint: 'user' } });
    const r = await saveConsentVersion({}, form({ ...fields, id }));
    expect(r.error).toBe(locked);
    expect(r.values?.text_en).toBe('English');
  });

  it('refuses a bad date before calling the database', async () => {
    const r = await saveConsentVersion({}, form({ ...fields, effective_on: '2026-02-30' }));
    expect(r.error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('is admin only', async () => {
    requireAdmin.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(saveConsentVersion({}, form(fields))).rejects.toThrow('NEXT_REDIRECT');
    expect(rpc).not.toHaveBeenCalled();
  });
});
