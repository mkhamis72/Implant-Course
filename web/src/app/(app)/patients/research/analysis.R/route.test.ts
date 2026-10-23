// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requirePermission = vi.fn();
vi.mock('@/lib/auth/session', () => ({ requirePermission: (...a: unknown[]) => requirePermission(...a) }));

import { GET } from './route';
import { analysisScript } from '@/lib/research/export/analysis';

beforeEach(() => {
  requirePermission.mockReset();
  requirePermission.mockResolvedValue({ active: true, role: 'admin' });
});

describe('GET /patients/research/analysis.R', () => {
  it('needs Research view', async () => {
    await GET();
    expect(requirePermission).toHaveBeenCalledWith('research');
  });

  it('sends the script as a plain-text download', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="analysis.R"');
    expect(await res.text()).toBe(analysisScript());
  });

  it('sends nothing when the guard refuses', async () => {
    requirePermission.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(GET()).rejects.toThrow('NEXT_REDIRECT');
  });
});
