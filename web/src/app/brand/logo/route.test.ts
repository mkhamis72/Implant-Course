// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const maybeSingle = vi.fn();
const rpc = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: (...args: unknown[]) => {
      rpc(...args);
      return { maybeSingle };
    },
  }),
}));
vi.mock('@/lib/tenant/current', () => ({ currentTenant: async () => ({ companyId: 'c1' }) }));

import { GET } from './route';

const req = (url: string) => new Request(url);

describe('GET /brand/logo', () => {
  beforeEach(() => {
    maybeSingle.mockReset();
    rpc.mockReset();
  });

  it("reads the host's company logo through branding_logo_for", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await GET(req('http://localhost:3000/brand/logo?v=1'));
    expect(rpc).toHaveBeenCalledWith('branding_logo_for', { p_company: 'c1' });
  });

  it('serves the stored bytes with their type, cached long when versioned', async () => {
    maybeSingle.mockResolvedValue({ data: { bytes: '\\x89504e47', content_type: 'image/png' }, error: null });
    const res = await GET(req('http://localhost:3000/brand/logo?v=3'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('is not cached without a version', async () => {
    maybeSingle.mockResolvedValue({ data: { bytes: '\\x89504e47', content_type: 'image/png' }, error: null });
    expect((await GET(req('http://localhost:3000/brand/logo'))).headers.get('cache-control')).toBe('no-cache');
  });

  it('is 404 when there is no logo or the read fails', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await GET(req('http://localhost:3000/brand/logo?v=1'))).status).toBe(404);
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect((await GET(req('http://localhost:3000/brand/logo?v=1'))).status).toBe(404);
  });
});

describe('GET /brand/logo failures', () => {
  it('is 404 when the read throws', async () => {
    maybeSingle.mockRejectedValue(new Error('network'));
    expect((await GET(req('http://localhost:3000/brand/logo?v=1'))).status).toBe(404);
  });
});
