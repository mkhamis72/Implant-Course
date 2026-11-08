import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { addProjectDomain, domainStatus, vercelConfigured } from './vercel';

const env = { VERCEL_API_TOKEN: 'tok-secret', VERCEL_PROJECT_ID: 'prj_1', VERCEL_TEAM_ID: 'team_1' };
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
const reply = (status: number, body: unknown = {}) => ({ status, json: async () => body });
afterEach(() => fetchMock.mockReset());

describe('vercelConfigured', () => {
  it('needs both the token and the project id', () => {
    expect(vercelConfigured(env)).toBe(true);
    expect(vercelConfigured({ VERCEL_API_TOKEN: 'x' })).toBe(false);
    expect(vercelConfigured({ VERCEL_PROJECT_ID: 'x', VERCEL_API_TOKEN: ' ' })).toBe(false);
  });
});

describe('addProjectDomain', () => {
  it('posts the address to the project, with the team and the token', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { name: 'acme.imploid.net' }));
    await addProjectDomain('acme.imploid.net', env);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.vercel.com/v10/projects/prj_1/domains?teamId=team_1');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'acme.imploid.net' });
    expect(init.headers.Authorization).toBe('Bearer tok-secret');
  });

  it('counts an address already on this project as added', async () => {
    fetchMock.mockResolvedValueOnce(reply(409, { error: { message: 'exists' } })).mockResolvedValueOnce(reply(200, { verified: true }));
    await expect(addProjectDomain('acme.imploid.net', env)).resolves.toBeUndefined();
  });

  it('fails with Vercel’s message, never the token, when the address is on another project', async () => {
    fetchMock.mockResolvedValueOnce(reply(409, { error: { message: 'in use by another project' } })).mockResolvedValueOnce(reply(404));
    const err = await addProjectDomain('acme.imploid.net', env).catch((e: Error) => e);
    expect((err as Error).message).toBe('Vercel did not add acme.imploid.net: in use by another project');
    expect((err as Error).message).not.toContain('tok-secret');
  });

  it('refuses without the settings, before calling Vercel', async () => {
    await expect(addProjectDomain('acme.imploid.net', {})).rejects.toThrow(/not set up/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('domainStatus', () => {
  it('is missing when not on the project', async () => {
    fetchMock.mockResolvedValueOnce(reply(404));
    expect(await domainStatus('acme.imploid.net', env)).toBe('missing');
  });

  it('is pending until verified and correctly pointed, then live', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { verified: false }));
    expect(await domainStatus('acme.imploid.net', env)).toBe('pending');
    fetchMock.mockResolvedValueOnce(reply(200, { verified: true })).mockResolvedValueOnce(reply(200, { misconfigured: true }));
    expect(await domainStatus('acme.imploid.net', env)).toBe('pending');
    fetchMock.mockResolvedValueOnce(reply(200, { verified: true })).mockResolvedValueOnce(reply(200, { misconfigured: false }));
    expect(await domainStatus('acme.imploid.net', env)).toBe('live');
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('https://api.vercel.com/v6/domains/acme.imploid.net/config?teamId=team_1');
  });
});
