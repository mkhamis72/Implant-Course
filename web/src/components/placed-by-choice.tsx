'use client';

export type PlacedBy = 'delegate' | 'doctor';

/** A course organizer's choice of who placed the implant: a delegate (default) or a doctor (0115): implants in Patients, bookings in Schedule. */
export function PlacedByChoice({ value, onChange }: { value: PlacedBy; onChange: (v: PlacedBy) => void }) {
  return (
    <fieldset>
      <legend className="label">Placed by</legend>
      <div className="flex gap-4 text-sm">
        {(['delegate', 'doctor'] as const).map((p) => (
          <label key={p} className="flex items-center gap-2">
            <input type="radio" name="placed-by" value={p} checked={value === p} onChange={() => onChange(p)} />
            {p === 'delegate' ? 'Delegate' : 'Doctor'}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
