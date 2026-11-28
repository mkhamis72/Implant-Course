'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { downloadPassport, PASSPORT_FAILED } from '@/lib/passport/client';

/** Builds the passport in the browser and downloads it; the list of generations refreshes after. */
export function GeneratePassport({ patientId }: { patientId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, startRefresh] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      await downloadPassport(patientId);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : PASSPORT_FAILED);
    } finally {
      setBusy(false);
      // The data route logs a generation even when drawing fails afterwards.
      startRefresh(() => router.refresh());
    }
  }

  return (
    <div className="space-y-2">
      <button type="button" className="btn" disabled={busy} onClick={generate}>
        {busy ? 'Preparing…' : 'Generate passport'}
      </button>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
    </div>
  );
}
