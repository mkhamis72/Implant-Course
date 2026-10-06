import { describe, it, expect } from 'vitest';
import { bySession, courseReportCsv, implantLabel, stats, summarise, type CourseReportRow } from './course-report';

const base: CourseReportRow = {
  site_id: 's1', session_id: 'se1', session_title: 'Day 1 surgery', session_date: '2030-03-02', slot_start: '2030-03-02T07:00:00Z',
  patient_name: 'Amal Hassan', file_no: 'P00012', tooth: 36, state: 'placed', placed_on: '2030-03-02',
  placing_delegate: 'Dr One', assisting_delegate: 'Dr Two', supervisor: 'Prof Laila',
  brand: 'Oxy', system: 'PSK', platform: null, diameter_mm: 4, length_mm: 10, description: '', lot_no: 'L1',
  torque_ncm: 35, isq: 70, bone_type: 'D2', technique: 'guided', graft: '', last_outcome: null,
};
const row = (over: Partial<CourseReportRow>): CourseReportRow => ({ ...base, ...over });

describe('stats', () => {
  it('ignores missing values and handles odd and even counts', () => {
    expect(stats([35, null, 45, 40])).toEqual({ n: 3, mean: 40, median: 40, min: 35, max: 45 });
    expect(stats([30, '40'])).toEqual({ n: 2, mean: 35, median: 35, min: 30, max: 40 });
  });
  it('rounds the median like the mean (no float noise)', () => {
    expect(stats([35.1, 35.2]).median).toBe(35.2);
  });
  it('returns nulls when nothing was recorded', () => {
    expect(stats([null, null])).toEqual({ n: 0, mean: null, median: null, min: null, max: null });
  });
});

describe('summarise', () => {
  it('counts implants, patients, techniques, bone types, sizes, people', () => {
    const s = summarise([
      base,
      row({ site_id: 's2', tooth: 46, technique: 'free_hand', bone_type: null, torque_ncm: null, isq: 80, placing_delegate: 'Dr Two', assisting_delegate: null }),
      row({ site_id: 's3', patient_name: 'Omar', file_no: 'P00013', state: 'failed', length_mm: 11.5 }),
    ]);
    expect(s.implants).toBe(3);
    expect(s.patients).toBe(2);
    expect(s.byTechnique).toEqual({ guided: 2, free_hand: 1 });
    expect(s.byState).toEqual({ placed: 2, failed: 1 });
    expect(s.byBoneType).toEqual({ D2: 2, 'Not recorded': 1 });
    expect(s.bySize).toEqual({ 'Oxy PSK Ø4.0 × 10 mm': 2, 'Oxy PSK Ø4.0 × 11.5 mm': 1 });
    expect(s.torque).toEqual({ n: 2, mean: 35, median: 35, min: 35, max: 35 });
    expect(s.delegates).toEqual([
      { name: 'Dr One', placed: 2, assisted: 0, meanTorque: 35 },
      { name: 'Dr Two', placed: 1, assisted: 2, meanTorque: null },
    ]);
    expect(s.supervisors).toEqual([{ name: 'Prof Laila', count: 3 }]);
  });
});

describe('bySession', () => {
  it('orders sessions by date and puts unlinked placements last', () => {
    const groups = bySession([
      row({ site_id: 'a', session_id: null, session_title: null, session_date: null, slot_start: null }),
      row({ site_id: 'b', session_id: 'se2', session_title: 'Day 2', session_date: '2030-03-03' }),
      base,
    ]);
    expect(groups.map((g) => [g.title, g.rows.length])).toEqual([
      ['Day 1 surgery', 1],
      ['Day 2', 1],
      ['Not linked to a session', 1],
    ]);
    expect(groups[0].summary.implants).toBe(1);
  });
});

describe('courseReportCsv', () => {
  it('writes one analysis-friendly row per implant', () => {
    const csv = courseReportCsv([row({ patient_name: '=Ali, Omar', torque_ncm: null })]).replace(/^﻿/, '');
    const [head, line] = csv.trim().split(/\r?\n/);
    expect(head).toBe(
      'Session,Session date,Patient,File,Tooth,Placed on,State,Placed by,Assisted by,Supervisor,Brand,System,Diameter (mm),Length (mm),Implant,Lot,Torque (Ncm),ISQ,Bone type,Technique,Graft,Last follow-up',
    );
    expect(line).toBe(
      `Day 1 surgery,2030-03-02,"'=Ali, Omar",P00012,36,2030-03-02,Placed,Dr One,Dr Two,Prof Laila,Oxy,PSK,4,10,Oxy PSK Ø4.0 × 10 mm,L1,,70,D2,Guided,,`,
    );
  });
  it('labels a site without a product as —', () => {
    expect(implantLabel(row({ brand: null }))).toBe('—');
  });
});
