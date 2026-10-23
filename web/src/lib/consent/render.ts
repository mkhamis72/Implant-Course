/** The placeholders a consent form version's text may use; the print pages fill them. */
export const CONSENT_PLACEHOLDERS = [
  'company_name', 'patient_name', 'file_no', 'course_name', 'date', 'version', 'effective_date',
] as const;
export type ConsentPlaceholder = (typeof CONSENT_PLACEHOLDERS)[number];
export type ConsentValues = Partial<Record<ConsentPlaceholder, string | null>>;

/** What an unknown placeholder or a missing value prints as: a line to write on. */
export const BLANK = '__________';

/** Replaces each `{placeholder}`; an unknown one, or a missing or empty value, becomes BLANK. */
export function fillConsent(text: string, values: ConsentValues): string {
  return text.replace(/\{([a-z_]+)\}/g, (_m, key: string) => {
    const value = (values as Record<string, string | null | undefined>)[key];
    return value && value.trim() ? value : BLANK;
  });
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const inline = (s: string) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

/**
 * The stored form text as HTML. A small markdown subset: `### ` headings, `**bold**`, `- ` lists, paragraphs split by
 * blank lines (single line breaks kept). Everything is escaped first, so the result is safe to inject.
 */
export function renderConsent(text: string): string {
  const out: string[] = [];
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    let para: string[] = [];
    let list: string[] = [];
    const flush = () => {
      if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
      if (list.length) out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`);
      para = [];
      list = [];
    };
    for (const raw of block.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const heading = /^#{1,3}\s+(.*)$/.exec(line);
      const item = /^-\s+(.*)$/.exec(line);
      if (heading) {
        flush();
        out.push(`<h3>${inline(heading[1])}</h3>`);
      } else if (item) {
        if (para.length) flush();
        list.push(item[1]);
      } else {
        if (list.length) flush();
        para.push(line);
      }
    }
    flush();
  }
  return out.join('');
}
