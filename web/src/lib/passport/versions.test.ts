import { describe, it, expect } from 'vitest';
import { attachmentDisposition, downloadSummary, printableLogo, recordsChangedSince, sizeLabel } from './versions';

describe('recordsChangedSince', () => {
  const generated = '2026-11-24T09:00:00.000+00:00';

  it('is false with no history, or only older changes', () => {
    expect(recordsChangedSince(generated, [])).toBe(false);
    expect(recordsChangedSince(generated, [{ table_name: 'implant_sites', at: '2026-11-24T08:59:59+00:00' }])).toBe(false);
  });

  it('is true when any patient record changed after the version', () => {
    expect(recordsChangedSince(generated, [
      { table_name: 'patients', at: '2026-11-20T08:00:00+00:00' },
      { table_name: 'site_components', at: '2026-11-24T09:00:01+00:00' },
    ])).toBe(true);
  });

  it('ignores the passports themselves, their downloads and the setting (or the latest would always be stale)', () => {
    expect(recordsChangedSince(generated, [
      { table_name: 'patient_passports', at: '2026-11-24T09:00:00.5+00:00' },
      { table_name: 'passport_downloads', at: '2026-11-24T10:00:00+00:00' },
      { table_name: 'passport_settings', at: '2026-11-24T11:00:00+00:00' },
    ])).toBe(false);
  });

  it('compares instants, not strings (offsets differ)', () => {
    // 11:30 in Cairo (+02:00) is 09:30 UTC: after the version.
    expect(recordsChangedSince(generated, [{ table_name: 'patients', at: '2026-11-24T11:30:00+02:00' }])).toBe(true);
    // 10:30 in Cairo is 08:30 UTC: before it.
    expect(recordsChangedSince(generated, [{ table_name: 'patients', at: '2026-11-24T10:30:00+02:00' }])).toBe(false);
  });
});

describe('downloadSummary', () => {
  it('says when a version was never downloaded', () => {
    expect(downloadSummary([])).toBe('Not downloaded yet');
  });

  it('counts downloads and names the latest by whom and when (Cairo date)', () => {
    expect(downloadSummary([
      { downloaded_at: '2026-11-20T10:00:00+00:00', by: 'Dr Early' },
      { downloaded_at: '2026-11-23T22:30:00+00:00', by: 'Dr Late' },
    ])).toBe('Downloaded 2 times, last by Dr Late on 24 Nov 2026');
  });

  it('one download, and an unknown downloader', () => {
    expect(downloadSummary([{ downloaded_at: '2026-11-20T10:00:00+00:00', by: null }]))
      .toBe('Downloaded 1 time, last by Unknown on 20 Nov 2026');
  });
});

describe('attachmentDisposition', () => {
  it('quotes the exact file name', () => {
    expect(attachmentDisposition('Implant passport P00123-3.pdf'))
      .toBe(`attachment; filename="Implant passport P00123-3.pdf"; filename*=UTF-8''Implant%20passport%20P00123-3.pdf`);
  });

  it('never lets quotes, backslashes, line breaks or non-ASCII break the header', () => {
    const header = attachmentDisposition('Implant passport A"\\\r\nبX-1.pdf');
    expect(header).toMatch(/^attachment; filename="Implant passport A_____X-1\.pdf"; filename\*=UTF-8''/);
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toMatch(/^[\x20-\x7e]+$/);
    expect(decodeURIComponent(header.split("UTF-8''")[1])).toBe('Implant passport A"\\\r\nبX-1.pdf');
  });
});

describe('printableLogo', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1]);

  it('keeps PNG and JPEG logos, by their bytes', () => {
    expect(printableLogo(png)).toEqual({ bytes: png, contentType: 'image/png' });
    expect(printableLogo(jpeg)).toEqual({ bytes: jpeg, contentType: 'image/jpeg' });
  });

  it('leaves a WebP logo (react-pdf cannot draw it) or anything else out: the clinic name prints alone', () => {
    expect(printableLogo(webp)).toBeNull();
    expect(printableLogo(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(printableLogo(null)).toBeNull();
  });
});

describe('sizeLabel', () => {
  it('KB below a megabyte (at least 1), MB with one decimal above', () => {
    expect(sizeLabel(200)).toBe('1 KB');
    expect(sizeLabel(86_000)).toBe('84 KB');
    expect(sizeLabel(1_258_291)).toBe('1.2 MB');
  });
});
