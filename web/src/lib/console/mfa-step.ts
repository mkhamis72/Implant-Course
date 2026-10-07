/** Console 2FA is mandatory: no verified authenticator → set one up; aal1 → enter the code. */
export function consoleMfaStep(factors: { status: string }[] | undefined, aalCurrent: string | null): 'setup' | 'verify' | 'ok' {
  if (!factors?.some((f) => f.status === 'verified')) return 'setup';
  return aalCurrent === 'aal2' ? 'ok' : 'verify';
}
