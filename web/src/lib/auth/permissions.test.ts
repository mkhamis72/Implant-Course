import { describe, it, expect } from 'vitest';
import { AREAS, canEdit, canSeeImplants, canView, permissionMessage, reportAccessNote, toPermissions } from './permissions';

const org = (permissions = {}) => ({ role: 'organizer' as const, permissions });

describe('permissions', () => {
  it('admins can do everything; delegates nothing', () => {
    for (const a of AREAS) {
      expect(canEdit({ role: 'admin', permissions: {} }, a)).toBe(true);
      expect(canView({ role: 'delegate', permissions: { [a]: 'edit' } }, a)).toBe(false);
    }
  });
  it('organizers follow their rows; edit implies view', () => {
    const p = org({ inventory: 'edit', courses: 'view' });
    expect(canView(p, 'inventory')).toBe(true);
    expect(canEdit(p, 'inventory')).toBe(true);
    expect(canView(p, 'courses')).toBe(true);
    expect(canEdit(p, 'courses')).toBe(false);
    expect(canView(p, 'patients')).toBe(false);
  });
  it('words the refusal like the database does', () => {
    expect(permissionMessage('edit', 'inventory')).toBe("You don't have permission to edit Inventory.");
  });
  it('maps permission rows, ignoring unknown areas and levels', () => {
    expect(
      toPermissions([
        { area: 'patients', level: 'edit' },
        { area: 'schedule', level: 'view' },
        { area: 'bogus', level: 'edit' },
        { area: 'courses', level: 'all' },
      ]),
    ).toEqual({ patients: 'edit', schedule: 'view' });
    expect(toPermissions(null)).toEqual({});
  });
});

describe('reportAccessNote', () => {
  it('explains an implant report that the viewer cannot fully see', () => {
    expect(reportAccessNote({ role: 'organizer', permissions: { delegates: 'view' } })).toBe(
      'Implant records are only shown to users with access to Patients.',
    );
    expect(reportAccessNote({ role: 'organizer', permissions: { delegates: 'view', schedule: 'view' } })).toBe(
      'Follow-up results and restorations are only shown to users with access to Patients.',
    );
    expect(reportAccessNote({ role: 'organizer', permissions: { delegates: 'view', patients: 'view' } })).toBeNull();
    expect(reportAccessNote({ role: 'admin', permissions: {} })).toBeNull();
  });
});

describe('canSeeImplants', () => {
  it('needs Patients or Schedule view (implant records are readable through either)', () => {
    expect(canSeeImplants({ role: 'organizer', permissions: { courses: 'view' } })).toBe(false);
    expect(canSeeImplants({ role: 'organizer', permissions: { courses: 'view', schedule: 'view' } })).toBe(true);
    expect(canSeeImplants({ role: 'organizer', permissions: { patients: 'edit' } })).toBe(true);
    expect(canSeeImplants({ role: 'admin', permissions: {} })).toBe(true);
    expect(canSeeImplants({ role: 'delegate', permissions: {} })).toBe(false);
  });
});
