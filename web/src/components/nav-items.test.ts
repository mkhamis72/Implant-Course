import { describe, it, expect } from 'vitest';
import { DELEGATE_NAV, visibleNavItems, isActive } from './nav-items';

const labels = (p: Parameters<typeof visibleNavItems>[0]) => visibleNavItems(p).map((i) => i.label);

describe('visibleNavItems', () => {
  it('shows everything and Admin to admins', () => {
    expect(labels({ role: 'admin', permissions: {}, features: ['inventory', 'statistics', 'teaching'] })).toEqual([
      'Dashboard', 'Patients', 'Schedule', 'Courses', 'Checklists', 'Inventory', 'Delegates', 'Statistics', 'Admin',
    ]);
  });
  it('shows organizers the panels they can view, never Admin', () => {
    expect(labels({ role: 'organizer', permissions: { inventory: 'view', courses: 'edit' }, features: ['inventory', 'statistics', 'teaching'] })).toEqual(['Dashboard', 'Courses', 'Inventory']);
    expect(labels({ role: 'organizer', permissions: { patients: 'view' }, features: ['inventory', 'statistics', 'teaching'] })).not.toContain('Statistics');
    expect(labels({ role: 'organizer', permissions: { research: 'view' }, features: ['inventory', 'statistics', 'teaching'] })).toContain('Statistics');
  });
  it('drops a switched-off module', () => {
    const l = labels({ role: 'admin', permissions: {}, features: ['inventory', 'teaching'] });
    expect(l).not.toContain('Statistics');
    expect(l).toContain('Checklists');
    expect(l).toContain('Inventory');
  });
  it('gives delegates their own menu', () => {
    expect(labels({ role: 'delegate', permissions: {}, features: ['inventory', 'statistics', 'teaching'] })).toEqual(DELEGATE_NAV.map((i) => i.label));
    expect(DELEGATE_NAV.map((i) => i.href)).toEqual(['/my', '/my/report', '/account/security']);
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
