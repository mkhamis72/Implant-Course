/** Company logo upload rules: PNG, JPEG or WebP by signature (never by name or browser type), <= 200 KB. */
export const MAX_LOGO_BYTES = 204800;
export type LogoType = 'image/png' | 'image/jpeg' | 'image/webp';

export function sniffLogo(bytes: Uint8Array): LogoType | null {
  const starts = (sig: number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

export function logoProblem(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return 'Choose an image file.';
  if (bytes.length > MAX_LOGO_BYTES) return 'The logo must be 200 KB or smaller.';
  if (!sniffLogo(bytes)) return 'The logo must be a PNG, JPEG or WebP image.';
  return null;
}

/** bytea in PostgREST's text form: `\x` followed by hex. */
export function encodeBytea(bytes: Uint8Array): string {
  return `\\x${Buffer.from(bytes).toString('hex')}`;
}

export function decodeBytea(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value.replace(/^\\x/, ''), 'hex'));
}
