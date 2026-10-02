import { describe, it, expect } from 'vitest';
import { contentDisposition, csvFilename, toCsv } from './csv';

describe('toCsv', () => {
  it('starts with a BOM, uses CRLF and quotes only when needed', () => {
    expect(toCsv(['Name', 'Tooth'], [['Amira', 36], ['Omar', null]])).toBe('﻿Name,Tooth\r\nAmira,36\r\nOmar,\r\n');
  });
  it('escapes commas, quotes and newlines', () => {
    expect(toCsv(['A'], [['Hassan, Ali'], ['Say "hi"'], ['two\nlines']])).toBe(
      '﻿A\r\n"Hassan, Ali"\r\n"Say ""hi"""\r\n"two\nlines"\r\n',
    );
  });
  it('neutralizes spreadsheet formulas', () => {
    expect(toCsv(['A'], [['=HYPERLINK("x")'], ['+1'], ['-2'], ['@cmd']])).toBe(
      '﻿A\r\n"\'=HYPERLINK(""x"")"\r\n\'+1\r\n\'-2\r\n\'@cmd\r\n',
    );
  });
});

describe('csvFilename (C1)', () => {
  it('keeps an ASCII fallback name and the full Unicode name separately', () => {
    expect(csvFilename('Dr Karim Adel', 'abc')).toEqual({ ascii: 'implants-Dr-Karim-Adel.csv', utf8: 'implants-Dr-Karim-Adel.csv' });
    const arabic = csvFilename('د. محمد خميس', '1b4e28ba');
    expect(arabic.ascii).toBe('implants-1b4e28ba.csv');
    expect(arabic.utf8).toBe('implants-د-محمد-خميس.csv');
    expect(/^[\x20-\x7e]+$/.test(arabic.ascii)).toBe(true);
  });
  it('builds a header value that Node accepts', () => {
    expect(() => new Headers({ 'Content-Disposition': contentDisposition(csvFilename('د. محمد', 'x')) })).not.toThrow();
  });
});
