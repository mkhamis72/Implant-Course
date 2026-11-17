import { describe, it, expect } from 'vitest';
import { companyPlanSchema, firstAdminSchema, onboardSchema, planSchema, statusSchema } from './schemas';

const err = (r: { error?: { issues: { message: string }[] } }) => r.error?.issues[0].message;
const base = { slug: 'acme', name: 'Acme Implants', hosts: 'acme.example.com\n Clinic.Acme.com ', email: ' Ann@Acme.com ', fullName: 'Ann Admin' };
describe('onboardSchema', () => {
  it('splits and normalises hosts, and the admin email', () => {
    const r = onboardSchema.parse(base);
    expect(r.hosts).toEqual(['acme.example.com', 'clinic.acme.com']);
    expect(r.email).toBe('ann@acme.com');
  });
  it('refuses a bad slug, no hosts, a bad host, a bad email and a short name', () => {
    expect(err(onboardSchema.safeParse({ ...base, slug: 'Acme Co' }))).toBe('Use 2–40 lower-case letters, digits or hyphens.');
    expect(err(onboardSchema.safeParse({ ...base, hosts: '  ' }))).toBe('Enter at least one address.');
    expect(err(onboardSchema.safeParse({ ...base, hosts: 'acme.example.com/x' }))).toBe('Not a valid address: acme.example.com/x');
    expect(err(onboardSchema.safeParse({ ...base, email: 'nope' }))).toBe('Enter a valid email address.');
    expect(err(onboardSchema.safeParse({ ...base, fullName: 'A' }))).toBe('Enter the full name (at least 2 characters).');
  });
});

describe('statusSchema', () => {
  const s = { slug: 'acme', status: 'suspended', reason: 'Unpaid invoice', confirm: 'acme' };
  it('needs a reason and the typed slug', () => {
    expect(statusSchema.parse(s)).toMatchObject({ reason: 'Unpaid invoice' });
    expect(err(statusSchema.safeParse({ ...s, reason: ' x ' }))).toBe('Give a reason (3–300 characters).');
    expect(err(statusSchema.safeParse({ ...s, confirm: 'acm' }))).toBe('Type the company’s slug to confirm.');
  });
});

describe('firstAdminSchema', () => {
  it('normalises the email', () => {
    expect(firstAdminSchema.parse({ slug: 'acme', email: ' Owner@Acme.COM ', fullName: 'Dr Owner' })).toEqual({ slug: 'acme', email: 'owner@acme.com', fullName: 'Dr Owner' });
  });
});

describe('planSchema', () => {
  const p = { name: ' Starter ', kind: 'course_organizer', module_inventory: 'on', module_statistics: 'on' };
  it('lists the checked modules and trims the name', () => {
    expect(planSchema.parse(p)).toEqual({ id: undefined, name: 'Starter', kind: 'course_organizer', modules: ['inventory', 'statistics'] });
    expect(planSchema.parse({ ...p, module_statistics: undefined }).modules).toEqual(['inventory']);
  });
  it('refuses a 1-character name and an unknown type', () => {
    expect(err(planSchema.safeParse({ ...p, name: ' A ' }))).toBe('Give a name (2–60 characters).');
    expect(planSchema.safeParse({ ...p, kind: 'hospital' }).success).toBe(false);
  });
});

describe('companyPlanSchema', () => {
  const id = 'c0000000-0000-4000-8000-00000000000c';
  it('reads the plan and the extras', () => {
    expect(companyPlanSchema.parse({ slug: 'acme', kind: 'course_organizer', plan_id: id, extra_statistics: 'on' }))
      .toEqual({ slug: 'acme', kind: 'course_organizer', plan_id: id, extras: ['statistics'] });
    expect(companyPlanSchema.safeParse({ slug: 'acme', kind: 'clinic', plan_id: 'x' }).success).toBe(false);
  });
});
