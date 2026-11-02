import { describe, it, expect, vi } from 'vitest';

const { row } = vi.hoisted(() => ({ row: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => ({
      select: () => ({ eq: (col: string, id: string) => ({ maybeSingle: async () => row(table, col, id) }) }),
    }),
  }),
}));
import { memberOfMyCompany } from './same-company';

describe('memberOfMyCompany', () => {
  it('is true when the admin can see the profile', async () => {
    row.mockReturnValue({ data: { user_id: 'u1' }, error: null });
    expect(await memberOfMyCompany('u1')).toBe(true);
    expect(row).toHaveBeenCalledWith('profiles', 'user_id', 'u1');
  });
  it('is false when RLS hides it or it does not exist', async () => {
    row.mockReturnValue({ data: null, error: null });
    expect(await memberOfMyCompany('u2')).toBe(false);
  });
});
