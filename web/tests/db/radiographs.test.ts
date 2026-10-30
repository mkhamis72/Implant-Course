import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { legacyFailure, makeCourse, makeDelegate, makePatient, makeProduct, place, receive, setPerms } from './fixtures';

const users = inject('testUsers');

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

const daysAgo = async (c: Client, n: number) =>
  (await c.query('select (public.cairo_today() - $1::int)::text as d', [n])).rows[0].d as string;

async function setup(c: Client, name = 'Zz Xray Patient') {
  await actAs(c, users.organizer);
  const implant = await makeProduct(c);
  const lot = await receive(c, implant, 10, 'XRY');
  const delegate = await makeDelegate(c, 'Zz Xray Delegate');
  const course = await makeCourse(c);
  const patient = await makePatient(c, name);
  const placedOn = await daysAgo(c, 30);
  const placeAt = (tooth: number, on = placedOn) =>
    place(c, { patient, tooth, product: implant, lot, delegate, supervisor: users.organizer, placedOn: on, course });
  return { patient, placedOn, placeAt };
}

type Level = { site: string; mesial_mm: number | null; distal_mm: number | null };
type Save = {
  id?: string | null; patient: string; takenOn?: string; type?: string; purpose?: string; teeth: number[];
  link?: string | null; notes?: string | null; levels?: Level[]; expected?: string | null;
};

const save = async (c: Client, a: Save) =>
  (await c.query(
    `select public.save_radiograph(p_id => $1, p_patient => $2, p_taken_on => coalesce($3::date, public.cairo_today()),
       p_type => $4, p_purpose => $5, p_teeth => $6::smallint[], p_link => $7, p_notes => $8, p_levels => $9::jsonb,
       p_expected_updated_at => $10::timestamptz) as id`,
    [a.id ?? null, a.patient, a.takenOn ?? null, a.type ?? 'periapical', a.purpose ?? 'planning', a.teeth,
     a.link ?? null, a.notes ?? null, JSON.stringify(a.levels ?? []), a.expected ?? null],
  )).rows[0].id as string;

const list = async (c: Client, patient: string) =>
  (await c.query(
    `select id, taken_on::text, type, purpose, teeth, link, notes, updated_at::text as updated_at, levels
     from public.radiographs_for($1)`,
    [patient],
  )).rows;

const updatedAt = async (c: Client, id: string) =>
  (await list(c, (await c.query('select patient_id from public.radiographs where id = $1', [id])).rows[0].patient_id))
    .find((r) => r.id === id)!.updated_at as string;

const voidIt = (c: Client, id: string, reason: string) => c.query('select public.void_radiograph($1, $2)', [id, reason]);

describe('save_radiograph', () => {
  it('saves a planning CBCT with teeth only and no implant', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const id = await save(c, { patient: s.patient, type: 'cbct', purpose: 'planning', teeth: [46, 36, 37], notes: ' Sinus check ' });
      const rows = await list(c, s.patient);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id, type: 'cbct', purpose: 'planning', teeth: [36, 37, 46], link: null, notes: 'Sinus check', levels: [] });
    });
  });

  it('saves a baseline periapical with bone levels for its implant', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await s.placeAt(36);
      await save(c, {
        patient: s.patient, purpose: 'baseline', teeth: [36], link: 'https://example.com/x.png',
        levels: [{ site, mesial_mm: 0.5, distal_mm: null }],
      });
      const [r] = await list(c, s.patient);
      expect(r.link).toBe('https://example.com/x.png');
      expect(r.levels).toEqual([{ site, tooth: 36, mesial_mm: 0.5, distal_mm: null }]);
    });
  });

  it('refuses a baseline dated before the placement', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await s.placeAt(36);
      const before = await daysAgo(c, 40);
      for (const purpose of ['baseline', 'loading', 'follow_up']) {
        await refused(c, () => save(c, { patient: s.patient, purpose, teeth: [36], takenOn: before }), /placed by its date/);
      }
      await refused(c, () => save(c, { patient: s.patient, purpose: 'baseline', teeth: [37] }), /placed by its date/);
      await save(c, { patient: s.patient, purpose: 'planning', teeth: [36], takenOn: before });
      await save(c, { patient: s.patient, purpose: 'baseline', teeth: [36], takenOn: s.placedOn });
      expect(await list(c, s.patient)).toHaveLength(2);
    });
  });

  it('refuses a future date', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const tomorrow = await daysAgo(c, -1);
      await refused(c, () => save(c, { patient: s.patient, teeth: [36], takenOn: tomorrow }), /future/);
    });
  });

  it('refuses invalid, repeated or no teeth, and unknown type or purpose', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await refused(c, () => save(c, { patient: s.patient, teeth: [] }), /tooth/i);
      await refused(c, () => save(c, { patient: s.patient, teeth: [19] }), /tooth/i);
      await refused(c, () => save(c, { patient: s.patient, teeth: [36, 36] }), /tooth/i);
      await refused(c, () => save(c, { patient: s.patient, teeth: [36], type: 'panoramic' }), /type/i);
      await refused(c, () => save(c, { patient: s.patient, teeth: [36], purpose: 'whim' }), /purpose/i);
      await refused(c, () => save(c, { patient: s.patient, teeth: [36], notes: 'x'.repeat(1001) }), /1000/);
    });
  });

  it('refuses a measurement for an implant not on the X-ray\'s teeth', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site36 = await s.placeAt(36);
      const site46 = await s.placeAt(46);
      await refused(c, () => save(c, {
        patient: s.patient, purpose: 'baseline', teeth: [36], levels: [{ site: site46, mesial_mm: 1, distal_mm: 1 }],
      }), /one of this X-ray/);
      // Another patient's implant on the same tooth.
      const other = await setup(c, 'Zz Xray Other');
      const otherSite = await other.placeAt(36);
      await refused(c, () => save(c, {
        patient: s.patient, purpose: 'baseline', teeth: [36], levels: [{ site: otherSite, mesial_mm: 1, distal_mm: 1 }],
      }), /one of this X-ray/);
      // Unticking a measured tooth while still sending its row.
      const id = await save(c, {
        patient: s.patient, purpose: 'baseline', teeth: [36, 46], levels: [{ site: site36, mesial_mm: 1, distal_mm: 1 }],
      });
      const expected = await updatedAt(c, id);
      await refused(c, () => save(c, {
        id, patient: s.patient, purpose: 'baseline', teeth: [46], levels: [{ site: site36, mesial_mm: 1, distal_mm: 1 }],
        expected,
      }), /one of this X-ray/);
      // A removed (not placed) implant can't be measured.
      await asPostgres(c);
      await c.query(`update public.implant_sites set state = 'removed' where id = $1`, [site46]);
      await actAs(c, users.organizer);
      await refused(c, () => save(c, {
        patient: s.patient, purpose: 'baseline', teeth: [36, 46], levels: [{ site: site46, mesial_mm: 1, distal_mm: 1 }],
      }), /one of this X-ray/);
    });
  });

  it('refuses a bone level outside -5 to 15 and a row with both blank', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await s.placeAt(36);
      const at = (mesial_mm: number | null, distal_mm: number | null) =>
        save(c, { patient: s.patient, purpose: 'baseline', teeth: [36], levels: [{ site, mesial_mm, distal_mm }] });
      await refused(c, () => at(-5.1, null), /-5|−5/);
      await refused(c, () => at(null, 15.1), /-5|−5/);
      await refused(c, () => at(null, null), /mesial or distal/i);
      await refused(c, () => c.query(
        `select public.save_radiograph(null, $1, public.cairo_today(), 'periapical', 'baseline', '{36}', null, null,
           $2::jsonb, null)`,
        [s.patient, JSON.stringify([{ site, mesial_mm: 1, distal_mm: 1 }, { site, mesial_mm: 2, distal_mm: 2 }])],
      ), /once/);
      await at(-5, 15);
      await at(1.25, null);
      const levels = (await list(c, s.patient)).flatMap((r) => r.levels);
      expect(levels.map((l: Level) => [l.mesial_mm, l.distal_mm]).sort()).toEqual([[-5, 15], [1.3, null]].sort());
    });
  });

  it('refuses a link without http(s)', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      for (const link of ['javascript:alert(1)', 'ftp://x', 'example.com', `https://${'a'.repeat(2000)}`]) {
        await refused(c, () => save(c, { patient: s.patient, teeth: [36], link }), /http:\/\/ or https:\/\//);
      }
      await save(c, { patient: s.patient, teeth: [36], link: '  ' });
      expect((await list(c, s.patient))[0].link).toBeNull();
    });
  });

  it('editing replaces the measurement set', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const a = await s.placeAt(36);
      const b = await s.placeAt(37);
      const id = await save(c, {
        patient: s.patient, purpose: 'follow_up', teeth: [36, 37],
        levels: [{ site: a, mesial_mm: 0.5, distal_mm: 0.5 }, { site: b, mesial_mm: 1, distal_mm: null }],
      });
      expect((await list(c, s.patient))[0].levels).toHaveLength(2);
      await save(c, {
        id, patient: s.patient, type: 'cbct', purpose: 'follow_up', teeth: [36, 37], notes: 'Edited',
        levels: [{ site: b, mesial_mm: 1.5, distal_mm: 2 }], expected: await updatedAt(c, id),
      });
      await save(c, {
        id, patient: s.patient, type: 'cbct', purpose: 'follow_up', teeth: [36, 37], notes: 'Edited',
        levels: [{ site: b, mesial_mm: 1.5, distal_mm: 2 }], expected: await updatedAt(c, id),
      });
      const rows = await list(c, s.patient);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ type: 'cbct', notes: 'Edited' });
      expect(rows[0].levels).toEqual([{ site: b, tooth: 37, mesial_mm: 1.5, distal_mm: 2 }]);
      const n = (await c.query('select count(*)::int as n from public.radiograph_bone_levels where radiograph_id = $1', [id])).rows[0].n;
      expect(n).toBe(1);
    });
  });

  it('an edit writes only the bone levels that changed', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const a = await s.placeAt(36);
      const b = await s.placeAt(37);
      const levels = [{ site: a, mesial_mm: 0.5, distal_mm: null }, { site: b, mesial_mm: 1, distal_mm: 1 }];
      const id = await save(c, { patient: s.patient, purpose: 'follow_up', teeth: [36, 37], levels });
      const audit = async () => {
        await asPostgres(c);
        const rows = (await c.query(
          `select action from public.audit_log where table_name = 'radiograph_bone_levels'
             and coalesce(after, before) ->> 'radiograph_id' = $1 order by id`, [id])).rows.map((r) => r.action as string);
        await actAs(c, users.organizer);
        return rows;
      };
      const before = (await audit()).length;
      await save(c, { id, patient: s.patient, purpose: 'follow_up', teeth: [36, 37], notes: 'Notes only', levels, expected: await updatedAt(c, id) });
      expect((await audit()).length).toBe(before);
      await save(c, {
        id, patient: s.patient, purpose: 'follow_up', teeth: [36, 37], notes: 'Notes only',
        levels: [{ site: a, mesial_mm: 1, distal_mm: null }, levels[1]], expected: await updatedAt(c, id),
      });
      expect((await audit()).slice(before)).toEqual(['UPDATE']);
    });
  });

  it('refuses a bone level on an implant placed after the X-ray date', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const early = await s.placeAt(36);
      const late = await s.placeAt(37, await daysAgo(c, 2));
      const takenOn = await daysAgo(c, 10);
      await refused(c, () => save(c, {
        patient: s.patient, purpose: 'follow_up', teeth: [36, 37], takenOn,
        levels: [{ site: early, mesial_mm: 0.5, distal_mm: null }, { site: late, mesial_mm: 0.5, distal_mm: null }],
      }), /A bone level can only be recorded for an implant placed by the X-ray's date\./);
    });
  });

  it('rejects a stale updated_at', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const id = await save(c, { patient: s.patient, teeth: [36] });
      await refused(c, () => save(c, { id, patient: s.patient, teeth: [36], expected: '2026-01-01T00:00:00Z' }), /changed by someone else/);
      await refused(c, () => save(c, { id, patient: s.patient, teeth: [36] }), /changed by someone else/);
      await refused(c, () => save(c, { patient: s.patient, teeth: [36], expected: '2026-01-01T00:00:00Z' }), /changed by someone else/);
      // An X-ray can't be moved to another patient.
      const other = await makePatient(c, 'Zz Xray Other');
      await refused(c, () => save(c, { id, patient: other, teeth: [36] }), /not found/i);
    });
  });

  it('newest first', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const old = await save(c, { patient: s.patient, teeth: [36], takenOn: await daysAgo(c, 10) });
      const recent = await save(c, { patient: s.patient, teeth: [36] });
      expect((await list(c, s.patient)).map((r) => r.id)).toEqual([recent, old]);
    });
  });

  it('void hides it from radiographs_for and needs a reason', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const id = await save(c, { patient: s.patient, teeth: [36] });
      const expected = await updatedAt(c, id);
      await refused(c, () => voidIt(c, id, '  '), /Say why this X-ray/);
      await voidIt(c, id, 'Wrong patient');
      expect(await list(c, s.patient)).toEqual([]);
      const row = (await c.query('select voided_at, voided_by, voided_reason from public.radiographs where id = $1', [id])).rows[0];
      expect(row.voided_at).not.toBeNull();
      expect(row.voided_by).toBe(users.organizer);
      expect(row.voided_reason).toBe('Wrong patient');
      await refused(c, () => save(c, { id, patient: s.patient, teeth: [36], expected }), /not found/i);
      await refused(c, () => voidIt(c, id, 'Again'), /not found/i);
    });
  });

  it('failed implants can be measured', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await s.placeAt(36);
      await legacyFailure(c, site, await daysAgo(c, 5), users.organizer);
      await save(c, { patient: s.patient, purpose: 'follow_up', teeth: [36], levels: [{ site, mesial_mm: 4, distal_mm: 5 }] });
      expect((await list(c, s.patient))[0].levels).toHaveLength(1);
    });
  });

  it('deleting the patient deletes its X-rays', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const patient = await makePatient(c, 'Zz Xray Delete');
      const id = await save(c, { patient, type: 'cbct', teeth: [36] });
      await c.query('select public.delete_patient($1)', [patient]);
      await asPostgres(c);
      expect((await c.query('select 1 from public.radiographs where id = $1', [id])).rows).toHaveLength(0);
    });
  });

  it('records history for the X-ray and its bone levels', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await s.placeAt(36);
      await save(c, { patient: s.patient, purpose: 'baseline', teeth: [36], levels: [{ site, mesial_mm: 0.5, distal_mm: null }] });
      await setPerms(c, users.target, { patients: 'view' });
      await actAs(c, users.target);
      const tables = (await c.query('select table_name from public.patient_history($1)', [s.patient])).rows.map((r) => r.table_name);
      expect(tables).toContain('radiographs');
      expect(tables).toContain('radiograph_bone_levels');
    });
  });
});

describe('radiograph permissions', () => {
  it('needs Edit on Patients', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const id = await save(c, { patient: s.patient, teeth: [36] });
      await setPerms(c, users.organizer, { patients: 'view' });
      await actAs(c, users.organizer);
      await refused(c, () => save(c, { patient: s.patient, teeth: [36] }), /permission/i);
      await refused(c, () => voidIt(c, id, 'x'), /permission/i);
    });
  });

  it('a viewer can read through radiographs_for', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await s.placeAt(36);
      await save(c, { patient: s.patient, purpose: 'baseline', teeth: [36], levels: [{ site, mesial_mm: 1, distal_mm: 1 }] });
      await actAs(c, users.viewer);
      const rows = await list(c, s.patient);
      expect(rows).toHaveLength(1);
      expect(rows[0].levels).toHaveLength(1);
      await refused(c, () => c.query(`update public.radiographs set notes = 'x'`), /permission/i);
      await setPerms(c, users.target, { schedule: 'view' });
      await actAs(c, users.target);
      expect(await list(c, s.patient)).toEqual([]);
    });
  });
});

describe('save_radiograph panoramic (0080)', () => {
  it('saves a panoramic X-ray of the whole mouth, with a bone level', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await s.placeAt(36);
      const teeth = [11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28, 31, 32, 33, 34, 35, 36, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48];
      const id = await save(c, { patient: s.patient, type: 'panoramic', purpose: 'follow_up', teeth,
        levels: [{ site, mesial_mm: 1, distal_mm: null }] });
      const [row] = await list(c, s.patient);
      expect(row).toMatchObject({ id, type: 'panoramic', teeth });
    });
  });

  it('still refuses an unknown type', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await refused(c, () => save(c, { patient: s.patient, type: 'mri', teeth: [16] }), /Choose the X-ray type/);
    });
  });
});

describe('save_radiograph dates against placement (0075)', () => {
  it('refuses an "other" X-ray before the first placement on its teeth; planning and implant-free teeth are fine', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await s.placeAt(16);
      const before = await daysAgo(c, 31);
      await refused(c, () => save(c, { patient: s.patient, takenOn: before, purpose: 'other', teeth: [16] }),
        new RegExp(`A non-planning X-ray can't be before the placement date \\(${s.placedOn}\\)\\.`));
      await refused(c, () => save(c, { patient: s.patient, takenOn: before, purpose: 'other', teeth: [15, 16] }),
        /A non-planning X-ray can't be before the placement date/);
      // Baseline / loading / follow-up were already refused without an implant placed by then (0064).
      await refused(c, () => save(c, { patient: s.patient, takenOn: before, purpose: 'baseline', teeth: [16] }),
        /needs an implant placed by its date/);
      expect(await save(c, { patient: s.patient, takenOn: before, purpose: 'planning', teeth: [16] })).toBeTruthy();
      expect(await save(c, { patient: s.patient, takenOn: before, purpose: 'other', teeth: [17] })).toBeTruthy();
      expect(await save(c, { patient: s.patient, takenOn: s.placedOn, purpose: 'other', teeth: [16] })).toBeTruthy();
    });
  });
});
