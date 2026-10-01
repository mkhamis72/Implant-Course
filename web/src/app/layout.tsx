import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Implant Course Manager',
  description: 'Patients, implants, inventory and courses for implant-course organizers',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
