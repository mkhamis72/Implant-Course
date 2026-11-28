import { describe, it, expect } from 'vitest';
import { printableLogo, recordsChangedSince } from './versions';

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

  it('ignores the generations themselves and the setting (or the latest would always be stale)', () => {
    expect(recordsChangedSince(generated, [
      { table_name: 'passport_settings', at: '2026-11-24T11:00:00+00:00' },
      { table_name: 'passport_generations', at: '2026-11-24T12:00:00+00:00' },
    ])).toBe(false);
  });

  it('compares instants, not strings (offsets differ)', () => {
    // 11:30 in Cairo (+02:00) is 09:30 UTC: after the version.
    expect(recordsChangedSince(generated, [{ table_name: 'patients', at: '2026-11-24T11:30:00+02:00' }])).toBe(true);
    // 10:30 in Cairo is 08:30 UTC: before it.
    expect(recordsChangedSince(generated, [{ table_name: 'patients', at: '2026-11-24T10:30:00+02:00' }])).toBe(false);
  });
});

describe('printableLogo', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1]);

  it('keeps PNG and JPEG logos, by their bytes, as a data URL (the model goes to the browser as JSON)', () => {
    expect(printableLogo(png)).toBe(`data:image/png;base64,${Buffer.from(png).toString('base64')}`);
    expect(printableLogo(jpeg)).toBe(`data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}`);
  });

  it('leaves a WebP logo (react-pdf cannot draw it) or anything else out: the clinic name prints alone', () => {
    expect(printableLogo(webp)).toBeNull();
    expect(printableLogo(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(printableLogo(null)).toBeNull();
  });
});
