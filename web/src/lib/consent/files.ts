/** Signed consent scans: a JPEG photo or a PDF by signature (never by name or browser type), 1 byte to 2 MB. */
export const MAX_CONSENT_BYTES = 2097152;
/** Photos are re-encoded in the browser: JPEG, longest side at most this, at this quality. */
export const MAX_IMAGE_SIDE = 2000;
export const JPEG_QUALITY = 0.8;

export type ConsentFileType = 'image/jpeg' | 'application/pdf';

export function sniffConsentFile(bytes: Uint8Array): ConsentFileType | null {
  const starts = (sig: number[]) => bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  return null;
}

export function consentFileProblem(bytes: Uint8Array): string | null {
  if (!sniffConsentFile(bytes)) return 'Upload a JPEG photo or a PDF.';
  if (bytes.length > MAX_CONSENT_BYTES) return 'The file is larger than 2 MB.';
  return null;
}

/** The size that fits within max × max, keeping the aspect ratio; never larger than the original. */
export function fitWithin(w: number, h: number, max = MAX_IMAGE_SIDE): { w: number; h: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}
