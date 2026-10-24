// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));
vi.mock('@/lib/auth/session', () => ({ requirePermission: vi.fn(async () => ({})), requireAdmin: vi.fn(async () => ({})) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { deleteStudy, saveStudy } from './actions';
import { requireAdmin, requirePermission } from '@/lib/auth/session';

const STUDY = '00000000-0000-4000-8000-000000000001';
const COURSE = '00000000-0000-4000-8000-000000000002';
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

function form(over: Record<string, string> = {}, letter: Blob | null = null) {
  const fd = new FormData();
  const values: Record<string, string> = {
    title: ' Short implants RCT ', committee: 'Cairo REC', approval_number: '', approval_date: '2026-09-01',
    protocol_name: '', protocol_version: '2.1', protocol_date: '', notes: '', ...over,
  };
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  fd.append('courses', COURSE);
  if (letter) fd.set('letter', letter);
  return fd;
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: STUDY, error: null });
  vi.mocked(requirePermission).mockReset().mockResolvedValue({} as never);
  vi.mocked(requireAdmin).mockReset().mockResolvedValue({} as never);
});

describe('saveStudy', () => {
  it('saves the study with blank fields as null and its courses, needing Research edit', async () => {
    expect(await saveStudy(null, form())).toEqual({});
    expect(requirePermission).toHaveBeenCalledWith('research', 'edit');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('save_study', {
      p_id: null, p_title: 'Short implants RCT', p_committee: 'Cairo REC', p_approval_number: null,
      p_approval_date: '2026-09-01', p_protocol_name: null, p_protocol_version: '2.1', p_protocol_date: null,
      p_notes: null, p_courses: [COURSE],
    });
  });

  it('uploads the letter as bytea with its sniffed type after saving', async () => {
    expect(await saveStudy(STUDY, form({}, new File([pdf], 'letter.pdf', { type: 'application/pdf' })))).toEqual({});
    expect(rpc).toHaveBeenNthCalledWith(2, 'set_study_letter', { p_study: STUDY, p_file: '\\x255044462d31', p_content_type: 'application/pdf' });
  });

  it('refuses a letter that is not a JPEG or PDF before saving anything', async () => {
    const r = await saveStudy(null, form({}, new File([new Uint8Array([1, 2, 3])], 'x.docx')));
    expect(r.error).toBe('Upload a JPEG photo or a PDF.');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('removes the letter when asked', async () => {
    expect(await saveStudy(STUDY, form({ remove_letter: 'on' }))).toEqual({});
    expect(rpc).toHaveBeenNthCalledWith(2, 'clear_study_letter', { p_study: STUDY });
  });

  it('requires the title and passes database refusals through', async () => {
    expect((await saveStudy(null, form({ title: '  ' }))).error).toBe('Enter the study title.');
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: { message: "The approval date can't be in the future.", hint: 'user' } });
    expect((await saveStudy(null, form())).error).toBe("The approval date can't be in the future.");
  });
});

describe('deleteStudy', () => {
  it('is admin only', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await deleteStudy(STUDY)).toEqual({});
    expect(requireAdmin).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('delete_study', { p_id: STUDY });
  });
});
