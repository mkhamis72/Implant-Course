import Link from 'next/link';

/** "No consent on file" in the patient header while the patient has no current (non-voided) consent record. */
export function ConsentBadge({ patientId, hasCurrent }: { patientId: string; hasCurrent: boolean }) {
  if (hasCurrent) return null;
  return (
    <Link href={`/patients/${patientId}/consent`}>
      <span className="badge-warn" data-testid="no-consent-badge">No consent on file</span>
    </Link>
  );
}
