/** Console 2FA is mandatory: no confirmed authenticator → set one up; aal1 → enter the code. */
export function consoleMfaStep(hasTotp: boolean, aal: string | null): 'setup' | 'verify' | 'ok' {
  if (!hasTotp) return 'setup';
  return aal === 'aal2' ? 'ok' : 'verify';
}
