import { PILOT_MESSAGE } from '@/lib/flags';

export function PilotBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p role="note" className="mb-4 rounded-md border border-warn-line bg-warn-soft px-3 py-2 text-sm text-warn print:hidden">
      {PILOT_MESSAGE}
    </p>
  );
}
