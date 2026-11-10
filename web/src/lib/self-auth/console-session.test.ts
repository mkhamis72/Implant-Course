import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }));
const h = vi.hoisted(() => ({ cookie: null as string | null, getSession: vi.fn(), issueDbToken: vi.fn() }));
vi.mock('./cookie', () => ({ readSessionCookie: async (kind: string) => (kind === 'console' ? h.cookie : 'tenant-cookie') }));
vi.mock('./console', () => ({ CONSOLE_COMPANY: 'console', consoleAuth: async () => ({ getSession: h.getSession, issueDbToken: h.issueDbToken }) }));
import { currentConsoleSession, consoleDbToken } from './console-session';

beforeEach(() => {
  h.cookie = 'tok';
  h.getSession.mockReset();
  h.issueDbToken.mockReset();
});

describe('currentConsoleSession', () => {
  it('asks for the session of company console from the console cookie', async () => {
    h.getSession.mockResolvedValue({ sessionId: 's' });
    expect(await currentConsoleSession()).toEqual({ sessionId: 's' });
    expect(h.getSession).toHaveBeenCalledWith('tok', 'console');
  });
  it('no cookie means no lookup, and a company session cookie is never read', async () => {
    h.cookie = null;
    expect(await currentConsoleSession()).toBeNull();
    expect(h.getSession).not.toHaveBeenCalled();
  });
});

describe('consoleDbToken', () => {
  it('mints from the session, and not at all without one', async () => {
    h.getSession.mockResolvedValue({ sessionId: 's' });
    h.issueDbToken.mockResolvedValue('jwt');
    expect(await consoleDbToken()).toBe('jwt');
    h.cookie = null;
    h.issueDbToken.mockClear();
    expect(await consoleDbToken()).toBeNull();
    expect(h.issueDbToken).not.toHaveBeenCalled();
  });
});
