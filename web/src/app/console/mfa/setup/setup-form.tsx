'use client';

import { useRouter } from 'next/navigation';
import { EnrollTotp } from '@/app/(app)/account/security/enroll-totp';
import { confirmConsoleEnroll, startConsoleEnroll } from '../../auth-actions';

export function ConsoleSetupForm() {
  const router = useRouter();
  // Verifying the new factor raises the session to aal2; the admin guard routes from /console.
  return <EnrollTotp start={startConsoleEnroll} confirm={confirmConsoleEnroll} onDone={() => router.push('/console')} />;
}
