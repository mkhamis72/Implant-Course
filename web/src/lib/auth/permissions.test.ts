import { describe, it, expect } from 'vitest';
import { AREAS, canEdit, canSeeImplants, canView, reportAccessNote, toPermissions } from './permissions';

const ALL = ['inventory', 'statistics', 'teaching'] as const;
const org = (permissions = {}) => ({ role: 'organizer' as const, permissions, features: ALL });

describe('permissions', () => {
  it('admins can do everything; delegates nothing', () => {
    for (const a of AREAS) {
      expect(canEdit({ role: 'admin', permissions: {}, features: ALL }, a)).toBe(true);
      expect(canView({ role: 'delegate', permissions: { [a]: 'edit' }, features: ALL }, a)).toBe(false);
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
    expect(reportAccessNote({ role: 'organizer', permissions: { delegates: 'view' }, features: ALL })).toBe(
      'Implant records are only shown to users with access to Patients.',
    );
    expect(reportAccessNote({ role: 'organizer', permissions: { delegates: 'view', schedule: 'view' }, features: ALL })).toBe(
      'Follow-up results and restorations are only shown to users with access to Patients.',
    );
    expect(reportAccessNote({ role: 'organizer', permissions: { delegates: 'view', patients: 'view' }, features: ALL })).toBeNull();
    expect(reportAccessNote({ role: 'admin', permissions: {}, features: ALL })).toBeNull();
  });
});

describe('canSeeImplants', () => {
  it('needs Patients or Schedule view (implant records are readable through either)', () => {
    expect(canSeeImplants({ role: 'organizer', permissions: { courses: 'view' }, features: ALL })).toBe(false);
    expect(canSeeImplants({ role: 'organizer', permissions: { courses: 'view', schedule: 'view' }, features: ALL })).toBe(true);
    expect(canSeeImplants({ role: 'organizer', permissions: { patients: 'edit' }, features: ALL })).toBe(true);
    expect(canSeeImplants({ role: 'admin', permissions: {}, features: ALL })).toBe(true);
    expect(canSeeImplants({ role: 'delegate', permissions: {}, features: ALL })).toBe(false);
  });
});

describe('features', () => {
  const features = ['inventory', 'teaching'] as const;
  it('hides an area whose module is off, even from admins', () => {
    expect(canView({ role: 'admin', permissions: {}, features }, 'research')).toBe(false);
    expect(canEdit({ role: 'admin', permissions: {}, features }, 'patients')).toBe(true);
  });
  it('hides it from organizers with a grant', () => {
    expect(canEdit({ role: 'organizer', permissions: { research: 'edit' }, features }, 'research')).toBe(false);
    expect(canView({ role: 'organizer', permissions: { research: 'edit' }, features }, 'research')).toBe(false);
  });
});
