import { SectionNav } from '@/components/section-nav';

export function PatientTabs({ patientId }: { patientId: string }) {
  const base = `/patients/${patientId}`;
  return (
    <SectionNav
      label="Patient sections"
      items={[
        { href: base, label: 'Chart' },
        { href: `${base}/implants`, label: 'Implants' },
        { href: `${base}/overview`, label: 'Overview' },
        { href: `${base}/notes`, label: 'Notes' },
        { href: `${base}/history`, label: 'History' },
      ]}
    />
  );
}
