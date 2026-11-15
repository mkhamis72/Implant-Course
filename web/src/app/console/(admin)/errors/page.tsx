import { requireConsoleAdmin } from '@/lib/console/session';
import { consoleStore } from '@/lib/console/store';
import { groupErrors } from '@/lib/console/errors';
import { ErrorsTable } from './errors-table';

/** The server errors the app recorded (public.error_log, 0107; masked, kept 30 days). The hourly Error alert emails
 *  about new ones; this page shows them all. docs/operations.md §G2. */
export default async function ConsoleErrorsPage() {
  await requireConsoleAdmin();
  const rows = await consoleStore().errors();
  const groups = groupErrors(rows);
  return (
    <div className="space-y-4">
      <div className="page-header">
        <h1>Errors</h1>
      </div>
      <p className="text-sm text-muted">
        Server errors from every company, last 30 days{rows.length ? `: ${rows.length} in ${groups.length} kind${groups.length === 1 ? '' : 's'}` : ''}.
        Email addresses, tokens and passwords are masked before they are recorded.
        {rows.length >= 1000 ? ' Only the latest 1000 are counted.' : ''}
      </p>
      <ErrorsTable groups={groups} />
    </div>
  );
}
