import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { escapeHtml } from './html';
import { blankToNull, optionalUuid } from './form-values';
import { isUuid } from './uuid';
import { DAYS_PER_MONTH } from './dates';

describe('escapeHtml', () => {
  it('escapes the five HTML characters and nothing else', () => {
    expect(escapeHtml(`A & <B> "c" 'd' é`)).toBe('A &amp; &lt;B&gt; &quot;c&quot; &#39;d&#39; é');
  });
});

describe('blankToNull', () => {
  it('turns an empty field into null and keeps everything else as it is', () => {
    expect(blankToNull('')).toBeNull();
    expect(blankToNull(undefined)).toBeNull();
    expect(blankToNull(null)).toBeNull();
    expect(blankToNull(' ')).toBe(' ');
    expect(blankToNull('x')).toBe('x');
    expect(blankToNull(0)).toBe(0);
  });
});

describe('optionalUuid', () => {
  it('accepts an id or nothing, refuses anything else', () => {
    const id = '0b9e5c2a-1d2e-4f3a-9b8c-7d6e5f4a3b2c';
    expect(optionalUuid.parse(id)).toBe(id);
    expect(optionalUuid.parse('')).toBeNull();
    expect(z.object({ a: optionalUuid }).safeParse({ a: 'nope' }).success).toBe(false);
  });
});

describe('isUuid', () => {
  it('accepts lower and upper case ids only', () => {
    expect(isUuid('0b9e5c2a-1d2e-4f3a-9b8c-7d6e5f4a3b2c')).toBe(true);
    expect(isUuid('0B9E5C2A-1D2E-4F3A-9B8C-7D6E5F4A3B2C')).toBe(true);
    expect(isUuid('0b9e5c2a-1d2e-4f3a-9b8c-7d6e5f4a3b2')).toBe(false);
    expect(isUuid(" or 1=1 --")).toBe(false);
  });
});

describe('DAYS_PER_MONTH', () => {
  it('is the average month: 365.25 / 12', () => {
    expect(DAYS_PER_MONTH).toBe(365.25 / 12);
  });
});
