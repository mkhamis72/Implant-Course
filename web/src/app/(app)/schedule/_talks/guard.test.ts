import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requirePermission } from '@/lib/auth/session';
import { redirect } from 'next/navigation';
import { requireTalks } from './guard';

vi.mock('@/lib/auth/session', () => ({ requirePermission: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(() => { throw new Error('REDIRECT'); }) }));

describe('requireTalks', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lets a course organizer in', async () => {
    vi.mocked(requirePermission).mockResolvedValue({ features: ['teaching'] } as never);
    await expect(requireTalks('edit')).resolves.toMatchObject({ features: ['teaching'] });
    expect(requirePermission).toHaveBeenCalledWith('schedule', 'edit');
  });

  it('sends a clinic back to the Schedule', async () => {
    vi.mocked(requirePermission).mockResolvedValue({ features: [] } as never);
    await expect(requireTalks()).rejects.toThrow('REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/schedule');
  });
});
