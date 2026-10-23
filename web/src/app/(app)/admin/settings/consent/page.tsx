import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { formatDate } from '@/lib/format';
import { VersionForm, type ConsentVersion } from './version-form';

export default async function ConsentSettingsPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [versions, current] = await Promise.all([
    supabase.rpc('consent_versions'),
    supabase.rpc('current_consent_version').maybeSingle<{ id: string }>(),
  ]);
  if (versions.error || current.error) throw new Error('Could not load the consent form versions');
  const list = (versions.data ?? []) as ConsentVersion[];
  const start = list.find((v) => v.id === current.data?.id) ?? list[0];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link href="/admin/settings" className="text-sm text-accent hover:underline">← Settings</Link>
        <h1>Consent form</h1>
        <p className="text-sm text-muted">
          The form patients sign, in English and Arabic. The current version (latest effective date on or before today) is
          the one that prints. Text placeholders: {'{company_name}'}, {'{patient_name}'}, {'{file_no}'}, {'{course_name}'},
          {' '}{'{date}'}, {'{version}'}, {'{effective_date}'}; formatting: ### heading, **bold**, - list item.
        </p>
      </div>

      <section className="space-y-2" aria-labelledby="blank-heading">
        <h2 id="blank-heading" className="text-lg font-semibold">Print a blank form</h2>
        <p className="flex flex-wrap gap-4 text-sm">
          <Link href="/admin/settings/consent/print?lang=en" aria-label="Print a blank form in English" className="text-accent hover:underline">English</Link>
          <Link href="/admin/settings/consent/print?lang=ar" aria-label="Print a blank form in Arabic" className="text-accent hover:underline">Arabic</Link>
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="versions-heading">
        <h2 id="versions-heading" className="text-lg font-semibold">Versions</h2>
        {list.length === 0 && <p className="text-sm text-muted">No form versions yet.</p>}
        {list.map((v) => (
          <details key={v.id} className="card" open={!v.in_use}>
            <summary className="cursor-pointer font-medium">
              {v.label} · effective {formatDate(v.effective_on)}
              {v.id === current.data?.id && <span className="badge badge-ok ms-2">Current</span>}
              {v.in_use && <span className="badge ms-2">Signed</span>}
            </summary>
            <div className="mt-3">
              <VersionForm version={v} />
            </div>
          </details>
        ))}
      </section>

      <section className="card space-y-3" aria-labelledby="add-heading">
        <h2 id="add-heading" className="text-lg font-semibold">Add a new version</h2>
        <p className="text-sm text-muted">Starts from the current text. Patients sign the new version once its effective date arrives.</p>
        <VersionForm start={start ? { text_en: start.text_en, text_ar: start.text_ar } : undefined} />
      </section>
    </div>
  );
}
