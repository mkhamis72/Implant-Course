import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { getBranding } from '@/lib/branding/get';
import { readParams, type PageSearchParams } from '@/lib/search-params';
import type { ConsentLanguage } from '@/lib/consent/labels';
import { ConsentDocument, type PrintableVersion } from '@/components/consent-document';
import { PrintButton } from '@/app/(app)/schedule/pull-list/print-button';

/** The current form version with the patient, course and date left blank, for bulk printing. */
export default async function BlankConsentPrintPage({ searchParams }: { searchParams: PageSearchParams }) {
  await requireAdmin();
  const q = await readParams(searchParams, 'lang');
  const language: ConsentLanguage = q.lang === 'ar' ? 'ar' : 'en';
  const supabase = await createClient();
  const [version, branding] = await Promise.all([
    supabase.rpc('current_consent_version').maybeSingle<PrintableVersion>(),
    getBranding(),
  ]);
  if (version.error) throw new Error('Could not load the consent form');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 print:hidden">
        <PrintButton />
        <Link href={`/admin/settings/consent/print?lang=${language === 'ar' ? 'en' : 'ar'}`} className="text-accent hover:underline">
          {language === 'ar' ? 'English' : 'Arabic'}
        </Link>
        <Link href="/admin/settings/consent" className="text-accent hover:underline">Back to consent settings</Link>
      </div>
      {version.data ? (
        <ConsentDocument version={version.data} language={language} values={{ company_name: branding.name }} />
      ) : (
        <p className="text-muted">No consent form version is in effect yet.</p>
      )}
    </div>
  );
}
