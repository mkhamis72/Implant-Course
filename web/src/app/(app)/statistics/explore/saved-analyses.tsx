'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { savedHref, type SavedConfig } from '@/lib/analysis/saved';
import { formatDate } from '@/lib/format';
import { deleteAnalysis, saveAnalysis } from './actions';

export type SavedRow = {
  id: string;
  title: string;
  config: SavedConfig;
  course_id: string | null;
  created_by: string;
  created_at: string;
  creator: { full_name: string } | null;
};

function Row({ row, canChange, courses, current }: { row: SavedRow; canChange: boolean; courses: Record<string, string>; current: SavedConfig }) {
  const [mode, setMode] = useState<'view' | 'rename' | 'delete'>('view');
  const [title, setTitle] = useState(row.title);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string }>) => start(async () => {
    const res = await fn();
    setError(res.error ?? null);
    if (!res.error) setMode('view');
  });

  return (
    <li className="space-y-1 border-b border-line py-2 last:border-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link href={savedHref(row.config)} className="font-medium text-accent hover:underline">{row.title}</Link>
        <span className="text-sm text-muted">
          by {row.creator?.full_name ?? 'a former user'} · {formatDate(row.created_at.slice(0, 10))}
          {row.course_id && courses[row.course_id] ? ` · ${courses[row.course_id]}` : ''}
        </span>
        {canChange && mode === 'view' && (
          <span className="ml-auto flex gap-2">
            <button type="button" className="btn-secondary btn py-1 text-sm" onClick={() => setMode('rename')}>Rename</button>
            <button type="button" className="btn-secondary btn py-1 text-sm" onClick={() => setMode('delete')}>Delete</button>
          </span>
        )}
      </div>
      {mode === 'rename' && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block flex-1"><span className="label">New title</span>
            <input className="input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></label>
          <button type="button" className="btn py-1 text-sm" disabled={pending} onClick={() => run(() => saveAnalysis(row.id, title, row.config))}>Save title</button>
          <button type="button" className="btn-secondary btn py-1 text-sm" onClick={() => setMode('view')}>Cancel</button>
          <button type="button" className="btn-secondary btn py-1 text-sm" disabled={pending}
            onClick={() => run(() => saveAnalysis(row.id, title, current))}>Replace with the current analysis</button>
        </div>
      )}
      {mode === 'delete' && (
        <div className="flex gap-2">
          <button type="button" className="btn-danger btn py-1 text-sm" disabled={pending} onClick={() => run(() => deleteAnalysis(row.id))}>Confirm delete</button>
          <button type="button" className="btn-secondary btn py-1 text-sm" onClick={() => setMode('view')}>Cancel</button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
    </li>
  );
}

export function SavedAnalyses({ items, canEdit, userId, isAdmin, courses, current }: {
  items: SavedRow[];
  canEdit: boolean;
  userId: string;
  isAdmin: boolean;
  courses: Record<string, string>;
  current: SavedConfig;
}) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  return (
    <section aria-labelledby="saved-analyses" className="card space-y-3">
      <h2 id="saved-analyses" className="font-semibold">Saved analyses</h2>
      {canEdit && current.query.o && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block flex-1"><span className="label">Title</span>
            <input className="input" value={title} maxLength={120} onChange={(e) => { setTitle(e.target.value); setSaved(false); }} /></label>
          <button type="button" className="btn" disabled={pending} onClick={() => start(async () => {
            const res = await saveAnalysis(null, title, current);
            setError(res.error ?? null);
            if (!res.error) { setSaved(true); setTitle(''); }
          })}>Save analysis</button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      {saved && <p className="text-sm text-ok" role="status">Saved.</p>}
      {items.length === 0
        ? <p className="text-sm text-muted">No saved analyses yet.</p>
        : (
          <ul>
            {items.map((row) => (
              <Row key={row.id} row={row} courses={courses} current={current}
                canChange={canEdit && (row.created_by === userId || isAdmin)} />
            ))}
          </ul>
        )}
    </section>
  );
}
