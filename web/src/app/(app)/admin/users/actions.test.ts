import { describe, it, expect, vi, afterEach } from 'vitest';

const { createAdminClient } = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ requireAdmin: vi.fn(async () => ({ user_id: 'me' })) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/env', () => ({ serverEnv: () => ({ siteUrl: 'http://localhost:3000', serviceRoleKey: 'x' }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { inviteUser } from './actions';
import { EMAIL_OFF_MESSAGE } from '@/lib/flags';

afterEach(() => vi.unstubAllEnvs());

describe('inviteUser with email off', () => {
  it('refuses without contacting Supabase', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'false');
    const form = new FormData();
    form.set('email', 'new@example.com');
    form.set('full_name', 'Dr New');
    form.set('role', 'organizer');
    expect(await inviteUser({}, form)).toEqual({ error: EMAIL_OFF_MESSAGE });
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
