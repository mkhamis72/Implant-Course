import Link from 'next/link';
import { getSettings, requireAdmin } from '@/lib/auth/session';
import { getBranding } from '@/lib/branding/get';
import { SettingsForm } from './settings-form';
import { BrandingForm } from './branding-form';
import { YourPlan } from './your-plan';
import { PassportSettingsForm } from './passport-form';
import { createClient } from '@/lib/supabase/server';
import { MEDICAL_LEVELS, type MedicalLevel } from '@/lib/passport/labels';

export default async function SettingsPage() {
  const me = await requireAdmin();
  const [settings, branding, passport] = await Promise.all([
    getSettings(), getBranding(), createClient().then((c) => c.rpc('passport_settings_current')),
  ]);
  if (passport.error) throw new Error('Could not load the passport settings');
  const medical: MedicalLevel = (MEDICAL_LEVELS as readonly string[]).includes(passport.data as string)
    ? (passport.data as MedicalLevel)
    : 'allergies_medications';
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
      <section className="space-y-2" aria-labelledby="passport-heading">
        <h2 id="passport-heading" className="text-lg font-semibold">Implant passport</h2>
        <p className="text-sm text-muted">What the medical section of new passports prints. Passports already generated keep what they printed.</p>
        <PassportSettingsForm medical={medical} />
      </section>
      <YourPlan plan={me.plan} features={me.features} />
    </div>
  );
}
