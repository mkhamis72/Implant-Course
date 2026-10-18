/**
 * Loading placeholder for loading.tsx while a server-rendered page arrives. `header` adds a page-title bar;
 * leave it off under a layout that already shows the title and tabs.
 */
export function PageSkeleton({ header = true }: { header?: boolean }) {
  return (
    <div className="skeleton space-y-4" aria-busy="true">
      <span className="sr-only">Loading…</span>
      {header && <div className="skeleton-bar h-8 w-56 max-w-full" />}
      <div className="card space-y-3">
        <div className="skeleton-bar h-4 w-2/3" />
        <div className="skeleton-bar h-4 w-full" />
        <div className="skeleton-bar h-4 w-5/6" />
      </div>
      <div className="card space-y-3">
        <div className="skeleton-bar h-4 w-1/2" />
        <div className="skeleton-bar h-4 w-3/4" />
      </div>
    </div>
  );
}
