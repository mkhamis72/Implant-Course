import { STATE_LABELS, TOOTH_STATES } from '@/lib/patients/types';
import { ToothGraphic } from './tooth-graphic';

export function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink" aria-label="Legend">
      {TOOTH_STATES.map((state) => (
        <li key={state} className="flex items-center gap-2">
          <svg viewBox="-2 -6 44 140" width={14} height={40} aria-hidden="true">
            <ToothGraphic type="premolar" jaw="upper" status={state} />
          </svg>
          <span>{STATE_LABELS[state]}</span>
        </li>
      ))}
    </ul>
  );
}
