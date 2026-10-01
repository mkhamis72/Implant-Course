type UpdateResult = {
  data: unknown[] | null;
  error: { message: string; hint?: string | null } | null;
};

/**
 * PostgREST returns no error when an update matches 0 rows (RLS denial or unknown id),
 * so callers must `.select()` the updated rows and check them. Returns a user-facing
 * message, or null when exactly the expected row changed.
 */
export function updateProblem(result: UpdateResult): string | null {
  if (result.error) {
    if (result.error.hint === 'last_admin') return 'At least one active admin is required.';
    console.error('Update failed:', result.error.message);
    return 'The change could not be saved. Please try again.';
  }
  if (!result.data || result.data.length === 0) return 'Nothing was changed. Reload the page and try again.';
  return null;
}
