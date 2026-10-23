import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConsentDocument } from './consent-document';

const version = {
  label: 'v1',
  effective_on: '2026-10-01',
  text_en: '**{company_name}**\nPatient name: {patient_name}\nCourse: {course_name}\n\n### About\n- one',
  text_ar: '**{company_name}**\nاسم المريض: {patient_name}',
};

describe('ConsentDocument', () => {
  it('prints the English text filled in, with the version footer', () => {
    render(<ConsentDocument version={version} language="en" values={{ company_name: 'Acme', patient_name: 'Sara Ali' }} />);
    const doc = screen.getByTestId('consent-document');
    expect(doc).toHaveAttribute('lang', 'en');
    expect(doc).toHaveAttribute('dir', 'ltr');
    expect(doc).toHaveTextContent('Patient name: Sara Ali');
    expect(doc).toHaveTextContent('Course: __________');
    expect(screen.getByRole('heading', { name: 'About' })).toBeInTheDocument();
    expect(doc).toHaveTextContent('Form version v1 · effective 01 Oct 2026');
  });

  it('prints Arabic right to left', () => {
    render(<ConsentDocument version={version} language="ar" values={{ company_name: 'Acme', patient_name: 'سارة' }} />);
    const doc = screen.getByTestId('consent-document');
    expect(doc).toHaveAttribute('dir', 'rtl');
    expect(doc).toHaveAttribute('lang', 'ar');
    expect(doc).toHaveTextContent('اسم المريض: سارة');
    expect(doc).toHaveTextContent('نسخة الإقرار v1 · سارية من');
  });
});
