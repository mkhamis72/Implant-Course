import { describe, it, expect } from 'vitest';
import { implantOf, myReportCsv, type MyReportRow } from './report';

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
