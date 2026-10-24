'use client';

import { useState } from 'react';
import { formatDate } from '@/lib/format';
import { studyLetterHref, type StudyRow } from '@/lib/research/studies';
import { deleteStudy } from './actions';
import { StudyForm } from './study-form';

type CourseOption = { id: string; name: string };

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const orDash = (v: string | null) => v ?? '—';

function DeleteStudy({ id }: { id: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function remove() {
    setPending(true);
    setError(null);
    const result = await deleteStudy(id);
    setPending(false);
    if (result.error) setError(result.error);
  }

  if (!confirming) return <button type="button" className="btn-secondary btn" onClick={() => setConfirming(true)}>Delete</button>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-danger btn" disabled={pending} onClick={remove}>Delete study</button>
        <button type="button" className="btn-secondary btn" onClick={() => setConfirming(false)}>Keep</button>
      </div>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
    </div>
  );
}

function StudyCard({ study, courses, editable, isAdmin }: { study: StudyRow; courses: CourseOption[]; editable: boolean; isAdmin: boolean }) {
  const [editing, setEditing] = useState(false);
  return (
    <article data-testid={`study-${study.id}`} className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2>{study.title}</h2>
        {study.on_export && <span className="badge">Named on an export</span>}
      </div>
      {editing ? (
        <>
          <StudyForm study={study} courses={courses} onDone={() => setEditing(false)} />
          <button type="button" className="btn-secondary btn" onClick={() => setEditing(false)}>Cancel</button>
        </>
      ) : (
        <>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <Detail label="Ethics committee">{orDash(study.committee)}</Detail>
            <Detail label="Approval number">{orDash(study.approval_number)}</Detail>
            <Detail label="Approval date">{study.approval_date ? formatDate(study.approval_date) : '—'}</Detail>
            <Detail label="Protocol">{orDash(study.protocol_name)}</Detail>
            <Detail label="Protocol version">{orDash(study.protocol_version)}</Detail>
            <Detail label="Protocol date">{study.protocol_date ? formatDate(study.protocol_date) : '—'}</Detail>
            <Detail label="Courses">{study.courses.length ? study.courses.map((c) => c.name).join(', ') : '—'}</Detail>
            <Detail label="Approval letter">
              {study.has_letter ? (
                <a href={studyLetterHref(study.id)} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                  Approval letter ↗
                </a>
              ) : 'Not uploaded'}
            </Detail>
          </dl>
          {study.notes && <p className="whitespace-pre-line text-sm">{study.notes}</p>}
          {editable && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary btn" onClick={() => setEditing(true)}>Edit</button>
              {isAdmin && !study.on_export && <DeleteStudy id={study.id} />}
            </div>
          )}
        </>
      )}
    </article>
  );
}

/** Every study, newest first. Editing needs Research edit; deleting is for admins, never once an export names the study. */
export function StudyList({ studies, courses, editable, isAdmin }: {
  studies: StudyRow[]; courses: CourseOption[]; editable: boolean; isAdmin: boolean;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-4">
      {editable && (adding ? (
        <section className="card space-y-3" aria-labelledby="add-study">
          <h2 id="add-study">Add study</h2>
          <StudyForm courses={courses} onDone={() => setAdding(false)} />
          <button type="button" className="btn-secondary btn" onClick={() => setAdding(false)}>Cancel</button>
        </section>
      ) : (
        <button type="button" className="btn" onClick={() => setAdding(true)}>Add study</button>
      ))}
      {studies.length === 0 ? <p className="text-muted">No studies yet.</p> : studies.map((s) => (
        <StudyCard key={s.id} study={s} courses={courses} editable={editable} isAdmin={isAdmin} />
      ))}
    </div>
  );
}
