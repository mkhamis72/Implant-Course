/**
 * A compact checkbox group for the patients search form: a dropdown (details/summary) whose button shows how
 * many options are ticked. The checkboxes stay in the GET form whether it is open or closed.
 */
export function FilterMenu({
  label, name, options, labels, checked, align = 'start',
}: {
  label: string;
  name: string;
  options: readonly string[];
  labels: Record<string, string>;
  checked: string[];
  /** 'end' opens the panel leftwards from the button's right edge (a menu near the right of a narrow screen). */
  align?: 'start' | 'end';
}) {
  const count = options.filter((o) => checked.includes(o)).length;
  return (
    <div className="block">
      <span className="label" aria-hidden="true">{label}</span>
      <details className="relative">
        <summary className="input flex cursor-pointer list-none items-center justify-between gap-2 whitespace-nowrap">
          <span>
            <span className="sr-only">{label}: </span>
            {count ? `${count} selected` : 'Any'}
          </span>
          <span aria-hidden="true">▾</span>
        </summary>
        <fieldset className={`card absolute ${align === 'end' ? 'right-0' : 'left-0'} z-20 mt-1 grid w-max min-w-full max-w-64 gap-1 p-2 shadow-lg`}>
          <legend className="sr-only">{label}</legend>
          {options.map((o) => (
            <label key={o} className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 text-sm hover:bg-sunken">
              <input type="checkbox" name={name} value={o} defaultChecked={checked.includes(o)} />
              {labels[o]}
            </label>
          ))}
        </fieldset>
      </details>
    </div>
  );
}

/**
 * The "is / is not" switch beside a filter (0147): name stage_not, course_not or supervisor_not, value 1 = is not.
 * Remounted on the URL's value (React 19 resets a form's selects after each submit).
 */
export function NotSelect({ name, label, value }: { name: string; label: string; value: boolean }) {
  return (
    <label className="block w-24">
      <select className="input" name={name} defaultValue={value ? '1' : ''} key={name + (value ? '-not' : '-is')} aria-label={label}>
        <option value="">is</option>
        <option value="1">is not</option>
      </select>
    </label>
  );
}
