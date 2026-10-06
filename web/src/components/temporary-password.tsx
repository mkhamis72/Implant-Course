/** A one-time password the admin hands over in person; the user changes it under Account security. */
export function TemporaryPassword({ password, className = '' }: { password: string; className?: string }) {
  return (
    <p data-testid="temporary-password" className={`rounded-md bg-warn-soft p-3 text-sm ${className}`}>
      Temporary password: <code className="font-mono font-semibold">{password}</code> — hand it over in person; it is shown only once.
      They change it under Account security.
    </p>
  );
}
