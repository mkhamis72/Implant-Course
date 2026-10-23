import { describe, it, expect } from 'vitest';
import { MAX_CONSENT_BYTES, consentFileProblem, fitWithin, sniffConsentFile } from './files';

const jpeg = (size = 10) => { const b = new Uint8Array(size); b.set([0xff, 0xd8, 0xff, 0xe0]); return b; };
const pdf = () => new TextEncoder().encode('%PDF-1.7\n');
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

describe('sniffConsentFile', () => {
  it('recognises JPEG and PDF by their first bytes', () => {
    expect(sniffConsentFile(jpeg())).toBe('image/jpeg');
    expect(sniffConsentFile(pdf())).toBe('application/pdf');
  });
  it('refuses anything else, whatever it is called', () => {
    expect(sniffConsentFile(png())).toBeNull();
    expect(sniffConsentFile(new TextEncoder().encode('%PDF'))).toBeNull(); // no dash: not the full signature
    expect(sniffConsentFile(new Uint8Array())).toBeNull();
  });
});

describe('consentFileProblem', () => {
  it('accepts JPEG and PDF up to 2 MB', () => {
    expect(consentFileProblem(jpeg())).toBeNull();
    expect(consentFileProblem(pdf())).toBeNull();
    expect(consentFileProblem(jpeg(MAX_CONSENT_BYTES))).toBeNull();
  });
  it('refuses PNG bytes (e.g. a PNG renamed .pdf)', () => {
    expect(consentFileProblem(png())).toBe('Upload a JPEG photo or a PDF.');
  });
  it('refuses a file one byte over 2 MB', () => {
    expect(MAX_CONSENT_BYTES).toBe(2097152);
    expect(consentFileProblem(jpeg(2097153))).toBe('The file is larger than 2 MB.');
  });
});

describe('fitWithin', () => {
  it('scales the longest side down to 2000 keeping the aspect ratio', () => {
    expect(fitWithin(4000, 3000)).toEqual({ w: 2000, h: 1500 });
    expect(fitWithin(3000, 4000)).toEqual({ w: 1500, h: 2000 });
  });
  it('never upscales', () => {
    expect(fitWithin(800, 600)).toEqual({ w: 800, h: 600 });
    expect(fitWithin(2000, 1000)).toEqual({ w: 2000, h: 1000 });
  });
  it('takes another limit', () => {
    expect(fitWithin(1000, 500, 100)).toEqual({ w: 100, h: 50 });
  });
});
