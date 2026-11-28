import { describe, it, expect } from 'vitest';
import { adminNavItems } from './nav';

const labels = (f: Parameters<typeof adminNavItems>[0]) => adminNavItems(f).map((i) => i.label);

describe('adminNavItems', () => {
  it('lists Supervisors and Lecturers with teaching, and Doctors, Catalogue and Screw sizes always', () => {
    expect(labels(['inventory', 'teaching'])).toEqual(['Users', 'Settings', 'Chairs', 'Doctors', 'Catalogue', 'Screw sizes', 'Supervisors', 'Lecturers']);
  });
  it('shows a clinic Doctors but no Supervisors or Lecturers', () => {
    expect(labels(['inventory', 'statistics'])).toEqual(['Users', 'Settings', 'Chairs', 'Doctors', 'Catalogue', 'Screw sizes']);
  });
});
