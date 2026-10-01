import { describe, it, expect } from 'vitest';
import { toCsv } from './csv';

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
