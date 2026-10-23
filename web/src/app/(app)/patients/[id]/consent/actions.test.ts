// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));
vi.mock('@/lib/auth/session', () => ({ requirePermission: vi.fn(async () => ({})) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { recordConsent, voidConsent } from './actions';
import { requirePermission } from '@/lib/auth/session';
import { revalidatePath } from 'next/cache';

const PATIENT = '00000000-0000-4000-8000-000000000001';
const VERSION = '00000000-0000-4000-8000-000000000002';
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);

function form(over: Record<string, string | null> = {}, file: Blob | null = new File([jpeg], 'consent.jpg', { type: 'image/jpeg' })) {
  const fd = new FormData();
  const values: Record<string, string | null> = {
    version: VERSION, language: 'ar', signed_on: '2026-10-20',
    treatment: 'yes', research: 'no', teaching_images: 'yes', follow_up: 'no', ...over,
  };
  for (const [k, v] of Object.entries(values)) if (v !== null) fd.set(k, v);
  if (file) fd.set('file', file);
  return fd;
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: 'new-id', error: null });
  vi.mocked(requirePermission).mockReset().mockResolvedValue({} as never);
});

describe('recordConsent', () => {
  it('records the answers and the file as bytea with its sniffed type', async () => {
    expect(await recordConsent(PATIENT, form())).toEqual({});
    expect(requirePermission).toHaveBeenCalledWith('patients', 'edit');
    expect(rpc).toHaveBeenCalledWith('record_consent', {
      p_patient: PATIENT, p_version: VERSION, p_language: 'ar', p_signed_on: '2026-10-20',
      p_treatment: true, p_research: false, p_teaching_images: true, p_follow_up: false,
      p_file: '\\xffd8ffe00102', p_content_type: 'image/jpeg',
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/patients/${PATIENT}/consent`);
  });

  it('is refused without Edit on Patients', async () => {
    vi.mocked(requirePermission).mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(recordConsent(PATIENT, form())).rejects.toThrow('NEXT_REDIRECT');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('needs all four answers', async () => {
    const r = await recordConsent(PATIENT, form({ teaching_images: null }));
    expect(r.error).toBe('Answer all four items (yes or no).');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('needs the signed form', async () => {
    expect((await recordConsent(PATIENT, form({}, null))).error).toBe('Upload the signed form.');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses a PNG named .pdf', async () => {
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'scan.pdf', { type: 'application/pdf' });
    expect((await recordConsent(PATIENT, form({}, png))).error).toBe('Upload a JPEG photo or a PDF.');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('shows database refusals', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'The date signed can\'t be in the future.', hint: 'user' } });
    expect((await recordConsent(PATIENT, form())).error).toBe('The date signed can\'t be in the future.');
  });
});

describe('voidConsent', () => {
  it('voids with a reason', async () => {
    expect(await voidConsent(PATIENT, VERSION, 'Wrong patient')).toEqual({});
    expect(requirePermission).toHaveBeenCalledWith('patients', 'edit');
    expect(rpc).toHaveBeenCalledWith('void_consent', { p_id: VERSION, p_reason: 'Wrong patient' });
  });

  it('is refused without Edit on Patients', async () => {
    vi.mocked(requirePermission).mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(voidConsent(PATIENT, VERSION, 'x')).rejects.toThrow('NEXT_REDIRECT');
    expect(rpc).not.toHaveBeenCalled();
  });
});
