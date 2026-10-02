'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { confirmEnroll, startEnroll, type Enrollment } from './actions';

export function EnrollTotp() {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function begin() {
    setError(null);
    startTransition(async () => {
      const result = await startEnroll();
      if ('error' in result) setError(result.error);
      else setEnrollment(result);
    });
  }

  function activate(event: React.FormEvent) {
    event.preventDefault();
    if (!enrollment) return;
    setError(null);
    startTransition(async () => {
      const result = await confirmEnroll(enrollment.factorId, code);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setEnrollment(null);
      setCode('');
      router.refresh();
    });
  }

  if (!enrollment) {
    return (
      <div className="space-y-2">
        <button className="btn" onClick={begin} disabled={pending}>
          Set up authenticator
        </button>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      </div>
    );
  }

  return (
    <form onSubmit={activate} className="space-y-4">
      <p className="text-sm text-ink">
        Scan this QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…), or enter the key manually.
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={enrollment.qrCode} alt="Authenticator QR code" width={180} height={180} />
      <p className="text-sm">
        Key: <code data-testid="totp-secret" className="rounded bg-sunken px-1">{enrollment.secret}</code>
      </p>
      <label className="block max-w-xs">
        <span className="label">Code from app</span>
        <input className="input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
      </label>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <button className="btn" disabled={pending}>
        Activate
      </button>
    </form>
  );
}
