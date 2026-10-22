import { describe, it, expect } from 'vitest';
import {
  coursesForDate, currentRestoration, defaultTeeth, describeTeeth, jawOf, loadingOf, problemEditSchema, problemSchema, restorationEditSchema, restorationSchema,
  restorationSpans,
  type Restoration,
} from './restorations';

const r = (over: Partial<Restoration>): Restoration => ({
  id: 'r1', stage: 'final', type: 'single_crown', teeth: [36], fitted_on: '2026-01-10', retention: null, material: null,
  delegate_id: null, supervisor_id: null, course_id: null, notes: '', ended_on: null, end_kind: null, end_reason: null,
  updated_at: '2026-01-10T10:00:00+00:00', site_ids: ['s1'], problems: [], ...over,
});

describe('arch helpers', () => {
  it('fills the run from the first to the last implant in arch order', () => {
    expect(defaultTeeth([34, 36])).toEqual([34, 35, 36]);
    expect(defaultTeeth([36, 34])).toEqual([34, 35, 36]);
    expect(defaultTeeth([15, 12, 22, 25])).toEqual([15, 14, 13, 12, 11, 21, 22, 23, 24, 25]);
    expect(defaultTeeth([46, 41, 31])).toEqual([46, 45, 44, 43, 42, 41, 31]);
    expect(defaultTeeth([])).toEqual([]);
  });

  it('tells the jaw of a tooth', () => {
    expect(jawOf(26)).toBe('upper');
    expect(jawOf(11)).toBe('upper');
    expect(jawOf(34)).toBe('lower');
    expect(jawOf(48)).toBe('lower');
  });

  it('describes teeth as one tooth or a run', () => {
    expect(describeTeeth([36])).toBe('36');
    expect(describeTeeth([34, 35, 36])).toBe('34–36');
  });
});

describe('currentRestoration', () => {
  it('is the restoration on the implant that has not ended', () => {
    const ended = r({ id: 'old', stage: 'temporary', ended_on: '2026-02-01', end_kind: 'replaced' });
    const now = r({ id: 'new', fitted_on: '2026-02-01' });
    expect(currentRestoration('s1', [ended, now])?.id).toBe('new');
    expect(currentRestoration('s2', [ended, now])).toBeNull();
    expect(currentRestoration('s1', [ended])).toBeNull();
  });
});

describe('loadingOf', () => {
  const at = (fitted: string) => loadingOf('2026-01-10', [r({ fitted_on: fitted })]);
  it('derives loading from the first restoration fitted', () => {
    expect(at('2026-01-10')).toBe('immediate');
    expect(at('2026-01-17')).toBe('immediate');
    expect(at('2026-01-18')).toBe('early');
    expect(at('2026-03-10')).toBe('early');
    expect(at('2026-03-11')).toBe('conventional');
    expect(loadingOf('2026-01-10', [])).toBeNull();
  });
  it('uses the earliest restoration, ended ones included', () => {
    expect(loadingOf('2026-01-10', [r({ fitted_on: '2026-06-01' }), r({ id: 'r0', fitted_on: '2026-01-12', ended_on: '2026-06-01', end_kind: 'replaced' })]))
      .toBe('immediate');
  });
  it('clamps two months to the end of a shorter month', () => {
    expect(loadingOf('2025-12-31', [r({ fitted_on: '2026-02-28' })])).toBe('early');
    expect(loadingOf('2025-12-31', [r({ fitted_on: '2026-03-01' })])).toBe('conventional');
  });
});

describe('coursesForDate', () => {
  it('lists the courses running on the date first', () => {
    const courses = [
      { id: 'a', name: 'Autumn', start_date: '2026-10-01', end_date: '2026-10-30' },
      { id: 'b', name: 'Spring', start_date: '2026-03-01', end_date: '2026-03-20' },
    ];
    expect(coursesForDate(courses, '2026-03-05')).toEqual({ running: [courses[1]], others: [courses[0]] });
  });
});

const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const add = {
  patientId: uuid(1), stage: 'final', type: 'bridge', sites: [uuid(2), uuid(3)], teeth: [34, 35, 36], fittedOn: '2026-01-10',
  retention: '', material: '', delegateId: '', supervisorId: '', courseId: '', remakeReason: '', notes: '',
};

describe('restorationSchema', () => {
  it('maps blanks to null', () => {
    const v = restorationSchema.parse(add);
    expect(v).toMatchObject({ retention: null, material: null, delegateId: null, supervisorId: null, courseId: null, remakeReason: null, notes: '' });
  });
  it('rejects unknown values', () => {
    expect(restorationSchema.safeParse({ ...add, stage: 'interim' }).error?.issues[0].message).toBe('Choose temporary or final.');
    expect(restorationSchema.safeParse({ ...add, type: 'veneer' }).error?.issues[0].message).toBe('Choose the restoration type.');
    expect(restorationSchema.safeParse({ ...add, retention: 'glue' }).error?.issues[0].message).toBe('Choose the retention from the list.');
    expect(restorationSchema.safeParse({ ...add, material: 'gold' }).error?.issues[0].message).toBe('Choose the material from the list.');
    expect(restorationSchema.safeParse({ ...add, fittedOn: '2999-01-01' }).success).toBe(false);
  });
  it('checks the implant count for the type', () => {
    expect(restorationSchema.safeParse({ ...add, sites: [uuid(2)] }).error?.issues[0].message)
      .toBe('A bridge, overdenture or full arch sits on at least two implants.');
    expect(restorationSchema.safeParse({ ...add, type: 'single_crown' }).error?.issues[0].message).toBe('A single crown sits on one implant.');
  });
});

describe('restorationEditSchema', () => {
  const edit = {
    patientId: uuid(1), restorationId: uuid(4), expectedUpdatedAt: '2026-01-10T10:00:00+00:00',
    retention: 'screw', material: '', delegateId: '', supervisorId: uuid(5), courseId: '', notes: ' ok ',
  };
  it('maps blanks to null and rejects unknown values', () => {
    expect(restorationEditSchema.parse(edit)).toMatchObject({ retention: 'screw', material: null, supervisorId: uuid(5), notes: 'ok' });
    expect(restorationEditSchema.safeParse({ ...edit, material: 'gold' }).success).toBe(false);
  });
});

describe('problem schemas', () => {
  const rec = { patientId: uuid(1), restorationId: uuid(4), noticedOn: '2026-03-01', type: 'debonding', action: 'recemented', notes: ' loose ' };
  it('saves type, date, action and trimmed notes', () => {
    expect(problemSchema.parse(rec)).toMatchObject({ noticedOn: '2026-03-01', type: 'debonding', action: 'recemented', notes: 'loose' });
  });
  it('rejects an unknown type, a missing date and a future date', () => {
    expect(problemSchema.safeParse({ ...rec, type: 'gold' }).error?.issues[0].message).toBe('Choose the problem type.');
    expect(problemSchema.safeParse({ ...rec, action: '' }).error?.issues[0].message).toBe('Choose the action taken.');
    expect(problemSchema.safeParse({ ...rec, noticedOn: '' }).success).toBe(false);
    expect(problemSchema.safeParse({ ...rec, noticedOn: '2999-01-01' }).success).toBe(false);
  });
  it('the edit schema also needs the problem and its version', () => {
    const edit = { ...rec, problemId: uuid(5), expectedUpdatedAt: '2026-03-01T10:00:00+00:00' };
    expect(problemEditSchema.parse(edit)).toMatchObject({ problemId: uuid(5) });
    expect(problemEditSchema.safeParse({ ...edit, expectedUpdatedAt: '' }).success).toBe(false);
  });
});

describe('restorationSpans (odontogram bars)', () => {
  const sites = [15, 12, 22, 25, 34, 36, 46].map((t) => ({ id: `s${t}`, tooth: t, state: 'restored' as const }));
  it('one span per current restoration, implants in arch order, labelled by type', () => {
    const spans = restorationSpans([
      r({ id: 'a', type: 'bridge', teeth: [34, 35, 36], site_ids: ['s36', 's34'] }),
      r({ id: 'b', type: 'full_arch', stage: 'temporary', teeth: [15, 14, 13, 12, 11, 21, 22, 23, 24, 25], site_ids: ['s22', 's15', 's25', 's12'] }),
      r({ id: 'c', teeth: [46], site_ids: ['s46'] }),
      r({ id: 'd', teeth: [46], site_ids: ['s46'], ended_on: '2026-01-10', end_kind: 'replaced' }),
    ], sites);
    expect(spans).toEqual([
      { id: 'a', teeth: [34, 35, 36], implantTeeth: [34, 36], label: 'Bridge 34–36', temporary: false },
      { id: 'b', teeth: [15, 14, 13, 12, 11, 21, 22, 23, 24, 25], implantTeeth: [15, 12, 22, 25], label: 'Full arch · on 15, 12, 22, 25', temporary: true },
      { id: 'c', teeth: [46], implantTeeth: [46], label: 'Crown', temporary: false },
    ]);
  });
  it('leaves out failed and removed implants, and a restoration with no active implant left', () => {
    const withLost = [...sites, { id: 's35', tooth: 35, state: 'failed' as const }, { id: 's44', tooth: 44, state: 'removed' as const }];
    expect(restorationSpans([
      r({ id: 'a', type: 'bridge', teeth: [34, 35, 36], site_ids: ['s34', 's35', 's36'] }),
      r({ id: 'b', teeth: [44], site_ids: ['s44'] }),
    ], withLost)).toEqual([{ id: 'a', teeth: [34, 35, 36], implantTeeth: [34, 36], label: 'Bridge 34–36', temporary: false }]);
  });
  it('labels an overdenture by its implants', () => {
    expect(restorationSpans([r({ type: 'overdenture', teeth: [34, 35, 36], site_ids: ['s34', 's36'] })], sites)[0].label).toBe('Overdenture · on 34, 36');
  });
});
