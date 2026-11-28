import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { toBlob, pdf, register } = vi.hoisted(() => {
  const toBlob = vi.fn();
  return { toBlob, pdf: vi.fn(() => ({ toBlob })), register: vi.fn() };
});
vi.mock('@react-pdf/renderer', () => ({ pdf }));
vi.mock('./document', () => ({ PassportDocument: () => null }));
vi.mock('./fonts', () => ({ registerPassportFonts: register }));
import { downloadPassport, PASSPORT_FAILED } from './client';

const fetchMock = vi.fn();
const createObjectURL = vi.fn(() => 'blob:passport');
const revokeObjectURL = vi.fn();
let clicked: HTMLAnchorElement[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  clicked = [];
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this); });
  toBlob.mockResolvedValue(new Blob(['%PDF-1.7'], { type: 'application/pdf' }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('downloadPassport', () => {
  it('fetches the data, draws the PDF with the fonts and downloads it under the given name', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    fetchMock.mockResolvedValue(Response.json({ passport: { the: 'model' }, fileName: 'Implant passport P1 2026-11-28.pdf' }));
    await downloadPassport('pat-1');
    expect(fetchMock).toHaveBeenCalledWith('/patients/pat-1/passport/data', expect.objectContaining({ cache: 'no-store' }));
    expect(register).toHaveBeenCalled();
    expect(pdf).toHaveBeenCalledWith(expect.objectContaining({ props: { model: { the: 'model' } } }));
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('Implant passport P1 2026-11-28.pdf');
    expect(clicked[0].getAttribute('href')).toBe('blob:passport');
    expect(clicked[0].isConnected).toBe(false);
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:passport');
  });

  it("throws the route's message and draws nothing", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'Patient not found.' }, { status: 400 }));
    await expect(downloadPassport('pat-1')).rejects.toThrow('Patient not found.');
    expect(pdf).not.toHaveBeenCalled();
    expect(clicked).toHaveLength(0);
  });

  it('a drawing failure (a library error) gives the generic message, not the raw error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValue(Response.json({ passport: { the: 'model' }, fileName: 'x.pdf' }));
    toBlob.mockRejectedValue(new Error('Standard font "Helvetica" is not registered'));
    await expect(downloadPassport('pat-1')).rejects.toThrow(PASSPORT_FAILED);
    expect(clicked).toHaveLength(0);
  });

  it('an unreadable answer gives the generic message', async () => {
    fetchMock.mockResolvedValue(new Response('<html>', { status: 500 }));
    await expect(downloadPassport('pat-1')).rejects.toThrow(PASSPORT_FAILED);
  });
});
