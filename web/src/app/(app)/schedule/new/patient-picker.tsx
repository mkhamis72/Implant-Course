'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ageOn } from '@/lib/patients/age';
import { todayIso } from '@/lib/dates';
import type { BookingPatient } from '@/lib/schedule/types';
import { searchBookingPatients } from '../actions';

const MIN_CHARS = 2;
const MAX_MATCHES = 10;
const DEBOUNCE_MS = 250;

type Props = { canOpenFile: boolean; value: BookingPatient | null; onChange: (p: BookingPatient | null) => void };

/** The parts that are known, joined with a middle dot. */
const joined = (parts: (string | number | null)[]) => parts.filter((v) => v !== null && v !== '').join(' · ');
/** Age today (Cairo). */
const ageOf = (p: BookingPatient) => ageOn(p.dob, new Date(`${todayIso()}T00:00:00`));

/**
 * The booking form's patient: a combobox searching non-archived patients (2+ characters, at most 10 matches); the
 * chosen patient shows as a card with Open file (Patients view only) and Change.
 */
export function PatientPicker({ canOpenFile, value, onChange }: Props) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const focusAfterChange = useRef(false);
  const latest = useRef(0);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<BookingPatient[]>([]);
  const [searched, setSearched] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    const q = query.trim();
    const n = ++latest.current;
    if (q.length < MIN_CHARS) {
      setMatches([]);
      setSearched(false);
      setActive(-1);
      return;
    }
    const timer = setTimeout(async () => {
      const found = await searchBookingPatients(q);
      // A slower, older search must not replace a newer one.
      if (n !== latest.current) return;
      setMatches(found.slice(0, MAX_MATCHES));
      setSearched(true);
      setActive(-1);
      setOpen(true);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!value && focusAfterChange.current) {
      focusAfterChange.current = false;
      inputRef.current?.focus();
    }
  }, [value]);

  function choose(p: BookingPatient) {
    setOpen(false);
    setActive(-1);
    onChange(p);
  }

  function change() {
    setQuery('');
    setMatches([]);
    setSearched(false);
    focusAfterChange.current = true;
    onChange(null);
  }

  if (value) {
    return (
      <div className="sm:col-span-2">
        <span className="label">Patient</span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded border border-line bg-sunken px-3 py-2 text-sm">
          <span className="font-medium">{joined([value.file_no, value.full_name, ageOf(value), value.phone])}</span>
          {canOpenFile ? (
            <a href={`/patients/${value.id}`} target="_blank" rel="noopener" className="text-accent hover:underline">
              Open file<span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            <span className="text-muted">File: no access</span>
          )}
          <button type="button" className="btn-secondary btn ml-auto py-1" onClick={change}>Change</button>
        </div>
      </div>
    );
  }

  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-option-${i}`;
  const expanded = open && matches.length > 0;

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!matches.length) return;
      setOpen(true);
      setActive((a) => (a + 1) % matches.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!matches.length) return;
      setOpen(true);
      setActive((a) => (a <= 0 ? matches.length - 1 : a - 1));
    } else if (e.key === 'Enter') {
      // Enter chooses the highlighted match instead of submitting the booking.
      if (expanded && active >= 0) {
        e.preventDefault();
        choose(matches[active]);
      }
    } else if (e.key === 'Escape') {
      if (expanded) e.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <div className="relative sm:col-span-2">
      <label htmlFor={`${id}-input`} className="label">Patient</label>
      <input
        ref={inputRef}
        id={`${id}-input`}
        className="input"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        autoComplete="off"
        placeholder="Name, file number or phone"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Matching patients"
        hidden={!expanded}
        className="absolute z-10 mt-1 max-h-80 w-full overflow-auto rounded border border-line bg-surface py-1 shadow-lg"
      >
        {expanded && matches.map((m, i) => (
          <li
            key={m.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            className={`cursor-pointer px-3 py-2 text-sm ${i === active ? 'bg-accent-soft' : 'hover:bg-sunken'}`}
            // Keep focus in the box so blur does not close the list before the click lands.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(m)}
          >
            <span className="block font-medium">{m.full_name}</span>
            <span className="block text-muted">{joined([m.file_no, ageOf(m), m.phone])}</span>
          </li>
        ))}
      </ul>
      {open && searched && matches.length === 0 && (
        <p role="status" className="mt-1 text-sm text-muted">No patients match.</p>
      )}
    </div>
  );
}
