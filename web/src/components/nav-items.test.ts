import { describe, it, expect } from 'vitest';
import { visibleNavItems } from './nav-items';

describe('visibleNavItems', () => {
  it('shows Admin to admins', () => {
    expect(visibleNavItems('admin').map((i) => i.label)).toEqual(['Dashboard', 'Patients', 'Inventory', 'Delegates', 'Admin']);
  });
  it('hides Admin from organizers', () => {
    expect(visibleNavItems('organizer').map((i) => i.label)).toEqual(['Dashboard', 'Patients', 'Inventory', 'Delegates']);
  });
});
