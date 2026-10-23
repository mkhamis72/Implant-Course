import Link from 'next/link';
import { getSettings, requireAdmin } from '@/lib/auth/session';
import { getBranding } from '@/lib/branding/get';
import { SettingsForm } from './settings-form';
import { BrandingForm } from './branding-form';

export default async function SettingsPage() {
  await requireAdmin();
  const [settings, branding] = await Promise.all([getSettings(), getBranding()]);
  return (
    <div className="space-y-6">
      <h1>Settings</h1>
      <SettingsForm settings={settings} />
      <section className="space-y-3" aria-labelledby="branding-heading">
        <h2 id="branding-heading" className="text-lg font-semibold">Branding</h2>
        <p className="text-sm text-muted">Your company’s name, colours and logo, shown to everyone including on the sign-in page. Blank fields use the defaults.</p>
        <BrandingForm branding={branding} />
      </section>
      <section className="space-y-2" aria-labelledby="consent-heading">
        <h2 id="consent-heading" className="text-lg font-semibold">Consent</h2>
        <p className="text-sm text-muted">The consent form patients sign: its versions and a blank form to print.</p>
        <Link href="/admin/settings/consent" className="text-accent hover:underline">Consent form settings</Link>
      </section>
    </div>
  );
}
