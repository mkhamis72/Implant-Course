import { ScheduleTabs } from './schedule-tabs';

export default function ScheduleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <ScheduleTabs />
      {children}
    </div>
  );
}
