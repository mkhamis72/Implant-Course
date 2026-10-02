import { describe, it, expect } from 'vitest';
import { visibleNavItems, isActive } from './nav-items';

describe('visibleNavItems', () => {
  it('shows Admin to admins', () => {
    expect(visibleNavItems('admin').map((i) => i.label)).toEqual(['Dashboard', 'Patients', 'Schedule', 'Courses', 'Checklists', 'Inventory', 'Delegates', 'Admin']);
  });
  it('hides Admin from organizers', () => {
    expect(visibleNavItems('organizer').map((i) => i.label)).toEqual(['Dashboard', 'Patients', 'Schedule', 'Courses', 'Checklists', 'Inventory', 'Delegates']);
  });
});

describe('isActive', () => {
  it('marks the section containing the current page', () => {
    expect(isActive('/', '/')).toBe(true);
    expect(isActive('/patients/abc/notes', '/')).toBe(false);
    expect(isActive('/patients/abc/notes', '/patients')).toBe(true);
    expect(isActive('/patientsx', '/patients')).toBe(false);
    expect(isActive('/admin/chairs', '/admin/users')).toBe(true);
  });
});
