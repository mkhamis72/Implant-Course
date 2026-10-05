import { getSettings, requireAdmin } from '@/lib/auth/session';
import { SettingsForm } from './settings-form';

export default async function SettingsPage() {
  await requireAdmin();
  const settings = await getSettings();
  return (
    <div className="space-y-6">
      <h1>Settings</h1>
      <SettingsForm settings={settings} />
    </div>
  );
}
