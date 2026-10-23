import { formatDate } from '@/lib/format';
import { fillConsent, renderConsent, type ConsentValues } from '@/lib/consent/render';
import type { ConsentLanguage } from '@/lib/consent/labels';

export type PrintableVersion = { label: string; effective_on: string; text_en: string; text_ar: string };

const FOOTER: Record<ConsentLanguage, (version: string, effective: string) => string> = {
  en: (v, d) => `Form version ${v} · effective ${d}`,
  ar: (v, d) => `نسخة الإقرار ${v} · سارية من ${d}`,
};

/**
 * One consent form version printed in one language (Arabic right to left) on A4. The version and its effective
 * date fill their placeholders and the footer; other values the caller leaves out print as a blank line.
 */
export function ConsentDocument({ version, language, values }: {
  version: PrintableVersion; language: ConsentLanguage; values: Omit<ConsentValues, 'version' | 'effective_date'>;
}) {
  const effective = formatDate(version.effective_on);
  const text = fillConsent(language === 'ar' ? version.text_ar : version.text_en, {
    ...values, version: version.label, effective_date: effective,
  });
  return (
    <article
      data-testid="consent-document"
      lang={language}
      dir={language === 'ar' ? 'rtl' : 'ltr'}
      className="card mx-auto max-w-[210mm] space-y-4 bg-surface text-ink print:max-w-none"
    >
      <style>{'@page { size: A4; margin: 15mm; }'}</style>
      <div
        className="space-y-3 leading-relaxed [&_h3]:mt-4 [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:ps-6"
        dangerouslySetInnerHTML={{ __html: renderConsent(text) }}
      />
      <p className="border-t border-line pt-2 text-xs text-muted">{FOOTER[language](version.label, effective)}</p>
    </article>
  );
}
