import { describe, it, expect } from 'vitest';
import { CLINIC_CONSENT_TEMPLATE } from './clinic-template';
import { BLANK, CONSENT_PLACEHOLDERS, fillConsent, renderConsent } from './render';

const texts = [CLINIC_CONSENT_TEMPLATE.text_en, CLINIC_CONSENT_TEMPLATE.text_ar];

describe('CLINIC_CONSENT_TEMPLATE', () => {
  it('is labelled as a draft that needs review', () => {
    expect(CLINIC_CONSENT_TEMPLATE.label).toBe('Draft — needs review');
    // consent_form_versions.label is 1–20 characters.
    expect(CLINIC_CONSENT_TEMPLATE.label.length).toBeLessThanOrEqual(20);
  });

  it('never mentions a course or a delegate, in either language', () => {
    for (const t of texts) {
      expect(t).not.toMatch(/course|delegate|trainee|student|teaching/i);
      expect(t).not.toContain('course_name');
      expect(t).not.toMatch(/دورة|دورات|الدورة|متدرب|مندوب|طلاب/);
    }
  });

  it('uses only placeholders render.ts fills, so a filled form has no blank line from an unknown one', () => {
    for (const t of texts) {
      const used = [...t.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);
      expect(used.length).toBeGreaterThan(0);
      for (const p of used) expect(CONSENT_PLACEHOLDERS).toContain(p);
      const filled = fillConsent(t, {
        company_name: 'Nile Clinic', patient_name: 'Sara Ali', file_no: 'F-12', date: '20 Nov 2026', version: 'v1',
        effective_date: '1 Nov 2026',
      });
      // Signature lines are underscores too, so compare with a fill that adds the one value left out.
      expect(fillConsent(t, { course_name: 'QQ-COURSE' })).not.toContain('QQ-COURSE');
      expect(filled.split(BLANK).length).toBe(t.split(BLANK).length);
      expect(filled).not.toMatch(/\{[a-z_]+\}/);
      expect(renderConsent(filled)).toContain('<h3>');
    }
  });

  it('has the same nine sections in English and Arabic', () => {
    const headings = (t: string) => t.split('\n').filter((l) => l.startsWith('### '));
    expect(headings(CLINIC_CONSENT_TEMPLATE.text_en)).toHaveLength(9);
    expect(headings(CLINIC_CONSENT_TEMPLATE.text_ar)).toHaveLength(9);
    expect(CLINIC_CONSENT_TEMPLATE.text_en).toMatch(/general anaesthesia in hospital/i);
    expect(CLINIC_CONSENT_TEMPLATE.text_en).toMatch(/withdraw/i);
  });
});
