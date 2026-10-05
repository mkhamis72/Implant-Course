/** Per-panel access for organizers. Mirrors public.can() / app_private.require_perm() in the database (0030). */
export const AREAS = ['patients', 'schedule', 'courses', 'checklists', 'inventory', 'delegates'] as const;
export type Area = (typeof AREAS)[number];
export type Level = 'view' | 'edit';
export type Permissions = Partial<Record<Area, Level>>;
export type Role = 'admin' | 'organizer' | 'delegate';

export const AREA_LABELS: Record<Area, string> = {
  patients: 'Patients',
  schedule: 'Schedule',
  courses: 'Courses',
  checklists: 'Checklists',
  inventory: 'Inventory',
  delegates: 'Delegates',
};

type Who = { role: Role; permissions: Permissions };

export function canView(p: Who, area: Area): boolean {
  if (p.role === 'admin') return true;
  return p.role === 'organizer' && Boolean(p.permissions[area]);
}

export function canEdit(p: Who, area: Area): boolean {
  if (p.role === 'admin') return true;
  return p.role === 'organizer' && p.permissions[area] === 'edit';
}

export function permissionMessage(level: Level, area: Area): string {
  return `You don't have permission to ${level} ${AREA_LABELS[area]}.`;
}

/** user_permissions rows → { area: level }. */
export function toPermissions(rows: { area: string; level: string }[] | null | undefined): Permissions {
  const out: Permissions = {};
  for (const r of rows ?? []) {
    if ((AREAS as readonly string[]).includes(r.area) && (r.level === 'view' || r.level === 'edit')) {
      out[r.area as Area] = r.level;
    }
  }
  return out;
}
