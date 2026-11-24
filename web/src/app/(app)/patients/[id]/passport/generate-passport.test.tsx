import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
import { GeneratePassport } from './generate-passport';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('GeneratePassport', () => {
  it('posts to the generate route, is disabled while it runs, then refreshes the list', async () => {
    let answer!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => { answer = r; }));
    render(<GeneratePassport patientId="pat-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Generate new passport' }));
    expect(fetchMock).toHaveBeenCalledWith('/patients/pat-1/passport/generate', { method: 'POST' });
    expect(screen.getByRole('button', { name: 'Generating…' })).toBeDisabled();
    answer(Response.json({ ok: true, version: 2 }));
    expect(await screen.findByText('Passport version 2 generated.')).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate new passport' })).toBeEnabled());
  });

  it("shows the route's message on a refusal and does not refresh", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'The passport is too large to store.' }, { status: 400 }));
    render(<GeneratePassport patientId="pat-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Generate new passport' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The passport is too large to store.');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a network failure or an unreadable answer shows the generic message', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<GeneratePassport patientId="pat-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Generate new passport' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not generate the passport. Please try again.');
  });
});
