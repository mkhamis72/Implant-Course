import { describe, it, expect, vi, beforeEach } from 'vitest';

const { installErrorReporting } = vi.hoisted(() => ({ installErrorReporting: vi.fn() }));
vi.mock('./lib/errors/report', () => ({ installErrorReporting }));
const { waitUntil } = vi.hoisted(() => ({ waitUntil: vi.fn() }));
vi.mock('@vercel/functions', () => ({ waitUntil }));
import { register } from './instrumentation';

beforeEach(() => installErrorReporting.mockClear());

describe('instrumentation', () => {
  it('turns on error reporting in the Node.js runtime, keeping the function alive until the error is sent', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    await register();
    expect(installErrorReporting).toHaveBeenCalledWith({ waitUntil });
    vi.unstubAllEnvs();
  });
  it('does nothing in the edge runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    await register();
    expect(installErrorReporting).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
