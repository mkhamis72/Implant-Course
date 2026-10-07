import { describe, it, expect } from 'vitest';
import { MAX_LOGO_BYTES, decodeBytea, encodeBytea, logoProblem, sniffLogo } from './image';

const bytes = (...b: number[]) => Uint8Array.from(b);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0);
const text = (s: string) => new TextEncoder().encode(s);

describe('sniffLogo', () => {
  it('recognises PNG, JPEG and WebP by their signature', () => {
    expect(sniffLogo(PNG)).toBe('image/png');
    expect(sniffLogo(JPEG)).toBe('image/jpeg');
    expect(sniffLogo(WEBP)).toBe('image/webp');
  });
  it('refuses SVG, HTML, GIF and RIFF files that are not WebP, whatever their name', () => {
    expect(sniffLogo(text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffLogo(text('<!doctype html><p>hi'))).toBeNull();
    expect(sniffLogo(text('GIF89a....'))).toBeNull();
    expect(sniffLogo(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45))).toBeNull();
  });
});

describe('logoProblem', () => {
  it('accepts a small image', () => expect(logoProblem(PNG)).toBeNull());
  it('refuses an empty file, a non-image and a file over 200 KB', () => {
    expect(logoProblem(new Uint8Array())).toBe('Choose an image file.');
    expect(logoProblem(text('<svg/>'))).toBe('The logo must be a PNG, JPEG or WebP image.');
    const big = new Uint8Array(MAX_LOGO_BYTES + 1);
    big.set(PNG);
    expect(logoProblem(big)).toBe('The logo must be 200 KB or smaller.');
    expect(MAX_LOGO_BYTES).toBe(204800);
  });
});

describe('bytea hex', () => {
  it('round-trips through the PostgREST hex format', () => {
    expect(encodeBytea(bytes(0x89, 0x50, 0x0a))).toBe('\\x89500a');
    expect(Array.from(decodeBytea('\\x89500a'))).toEqual([0x89, 0x50, 0x0a]);
  });
});
