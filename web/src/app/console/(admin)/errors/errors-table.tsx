import type { ErrorGroup } from '@/lib/console/errors';
import { formatDateTime } from '@/lib/format';

/** The recorded server errors, one row per kind (equal message), the most recent first. */
export function ErrorsTable({ groups }: { groups: ErrorGroup[] }) {
  if (!groups.length) return <p className="text-muted">No errors recorded in the last 30 days.</p>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Last seen</th>
          <th>Times</th>
          <th>First seen</th>
          <th>Error</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <tr key={g.message}>
            <td data-label="Last seen" className="whitespace-nowrap">{formatDateTime(g.last)}</td>
            <td data-label="Times">{g.count}</td>
            <td data-label="First seen" className="whitespace-nowrap">{formatDateTime(g.first)}</td>
            <td data-label="Error" className="break-all font-mono text-sm">{g.message}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
