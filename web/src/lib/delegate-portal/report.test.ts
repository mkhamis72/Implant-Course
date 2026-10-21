import { describe, it, expect } from 'vitest';
import { implantOf, myReportCsv, myRestorationStatus, type MyReportRow, type MyRestorationRow } from './report';

const row: MyReportRow = {
  site_id: 's1', role: 'placing', course_name: 'Course 12', patient_name: 'Amal Hassan', file_no: 'P00012', tooth: 36,
  state: 'placed', placed_on: '2030-03-02', brand: 'Oxy', system: 'PSK', platform: null, diameter_mm: 4, length_mm: 10,
  description: '', lot_no: 'L1', last_outcome: null, technique: 'guided',
};

describe('my report', () => {
  it('labels the implant like the rest of the app', () => {
    expect(implantOf(row)).toBe('Oxy PSK Ø4.0 × 10 mm');
    expect(implantOf({ ...row, brand: null })).toBe('—');
  });
  it('writes one CSV line per implant', () => {
    const csv = myReportCsv([row]);
    const [head, line] = csv.replace(/^﻿/, '').trim().split(/\r?\n/);
    expect(head).toBe('Course,Patient,File,Tooth,Role,Implant,Technique,Lot,Placed on,State,Last follow-up');
    expect(line).toBe('Course 12,Amal Hassan,P00012,36,Placed,Oxy PSK Ø4.0 × 10 mm,Guided,L1,2030-03-02,Placed,');
  });
});

const resto: MyRestorationRow = {
  restoration_id: 'r1', course_name: 'Course 12', patient_name: 'Amal Hassan', file_no: 'P00012', teeth: [34, 35, 36],
  stage: 'final', type: 'bridge', fitted_on: '2030-03-20', ended_on: null,
};

describe('my report restorations', () => {
  it('adds a restorations section after the implant rows', () => {
    const lines = myReportCsv([row], [resto, { ...resto, restoration_id: 'r2', teeth: [36], ended_on: '2030-04-01' }]).replace(/^﻿/, '').split(/\r?\n/);
    expect(lines[2]).toBe('');
    expect(lines[3]).toBe('restoration,course,patient,file_no,teeth,stage,type,fitted_on,status');
    expect(lines[4]).toBe('restoration,Course 12,Amal Hassan,P00012,34–36,Final,Bridge,2030-03-20,Current');
    expect(lines[5]).toBe('restoration,Course 12,Amal Hassan,P00012,36,Final,Bridge,2030-03-20,Ended');
  });
  it('leaves the CSV unchanged without restorations', () => {
    expect(myReportCsv([row], [])).toBe(myReportCsv([row]));
    expect(myRestorationStatus(resto)).toBe('Current');
  });
});
