import { historyLabel, type HistoryEntry } from '@/lib/admin/history';

/** The last admin changes to this user (admin_user_history: newest first, at most 10). */
export function UserHistory({ entries }: { entries: HistoryEntry[] }) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-sm text-accent">History</summary>
      {entries.length === 0 ? (
        <p className="mt-1 text-sm text-muted">No changes recorded.</p>
      ) : (
        <ul className="mt-1 space-y-1 text-sm">
          {entries.map((entry, i) => (
            <li key={`${entry.at}-${entry.kind}-${i}`}>{historyLabel(entry)}</li>
          ))}
        </ul>
      )}
    </details>
  );
}
