import Link from 'next/link';
import type { ResearchFilters } from '@/lib/research/view';

type Option = { id: string; name: string };

/** GET form: the filters live in the URL so every number's drill-down link can carry them. */
export function FilterForm({ filters, courses, delegates, brands, systems }: {
  filters: ResearchFilters;
  courses: Option[];
  delegates: Option[];
  brands: string[];
  systems: string[];
}) {
  return (
    <form className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Filters">
      <label className="block">
        <span className="label">Course</span>
        <select className="input" name="course" defaultValue={filters.course}>
          <option value="">All courses</option>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="label">Placed from</span>
        <input className="input" type="date" name="from" defaultValue={filters.from} />
      </label>
      <label className="block">
        <span className="label">Placed to</span>
        <input className="input" type="date" name="to" defaultValue={filters.to} />
      </label>
      <label className="block">
        <span className="label">Placing delegate</span>
        <select className="input" name="delegate" defaultValue={filters.delegate}>
          <option value="">All delegates</option>
          {delegates.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="label">Brand</span>
        <select className="input" name="brand" defaultValue={filters.brand}>
          <option value="">All brands</option>
          {brands.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="label">Line / type</span>
        <select className="input" name="system" defaultValue={filters.system}>
          <option value="">All lines and types</option>
          {systems.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-3">
        <button className="btn">Apply</button>
        <Link href="/patients/research" className="text-accent hover:underline">Clear filters</Link>
      </div>
    </form>
  );
}
