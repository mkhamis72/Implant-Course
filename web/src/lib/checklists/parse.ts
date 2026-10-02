// "- ", "* ", "• ", "– ", "1. ", "2) ", "[ ]", "[x]" — possibly combined, e.g. "- [ ] item".
const BULLET = /^(?:[-*•–]\s+|\d+[.)]\s+|\[[ xX]?\]\s*)/;

/** One item per non-blank line, with leading bullets / numbering / task boxes removed. */
export function parseChecklistText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => {
      let s = line.trim();
      for (let i = 0; i < 3 && BULLET.test(s); i++) s = s.replace(BULLET, '').trim();
      if (/^(?:[-*•–]|\[[ xX]?\])$/.test(s)) return '';
      return s;
    })
    .filter((s) => s.length > 0);
}
