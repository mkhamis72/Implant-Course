'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const FAILED = 'Could not generate the passport. Please try again.';

/** Posts to the generate route; the button stays disabled until the new version is listed. */
export function GeneratePassport({ patientId }: { patientId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [result, setResult] = useState<{ ok?: string; error?: string }>({});

  async function generate() {
    setBusy(true);
    setResult({});
    try {
      const res = await fetch(`/patients/${patientId}/passport/generate`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { version?: number; error?: string };
      if (!res.ok || !body.version) {
        setResult({ error: body.error || FAILED });
        return;
      }
      setResult({ ok: `Passport version ${body.version} generated.` });
      startRefresh(() => router.refresh());
    } catch {
      setResult({ error: FAILED });
    } finally {
      setBusy(false);
    }
  }

  const pending = busy || refreshing;
  return (
    <div className="space-y-2">
      <button type="button" className="btn" disabled={pending} onClick={generate}>
        {busy ? 'Generating…' : 'Generate new passport'}
      </button>
      {result.error && <p role="alert" className="text-sm text-bad">{result.error}</p>}
      {result.ok && <p className="text-sm text-ok">{result.ok}</p>}
    </div>
  );
}
