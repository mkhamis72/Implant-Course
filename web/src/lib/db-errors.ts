type DbError = { message: string; hint?: string | null; code?: string } | null | undefined;

/** Business errors (raised with hint = 'user') are shown as-is; everything else is logged and hidden. */
export function userMessage(error: DbError): string | null {
  if (!error) return null;
  if (error.hint === 'user') return error.message;
  if (error.code === '42501') return 'You are not allowed to do that. Your session may have ended — sign in again.';
  console.error('Database error:', error.message);
  return 'Something went wrong. Please try again.';
}
