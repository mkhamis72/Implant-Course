import { describe, it, expect } from 'vitest';
import { BLANK, fillConsent, renderConsent } from './render';

const all = {
  company_name: 'Acme Academy',
  patient_name: 'Sara Ali',
  file_no: 'F-12',
  course_name: 'Course 3',
  date: '23 Oct 2026',
  version: 'v1',
  effective_date: '1 Oct 2026',
};

describe('fillConsent', () => {
  it('replaces every placeholder', () => {
    const text = '{company_name} {patient_name} {file_no} {course_name} {date} {version} {effective_date}';
    expect(fillConsent(text, all)).toBe('Acme Academy Sara Ali F-12 Course 3 23 Oct 2026 v1 1 Oct 2026');
  });

  it('blanks a missing course, an empty value and an unknown placeholder', () => {
    expect(fillConsent('Course: {course_name}', { ...all, course_name: undefined })).toBe(`Course: ${BLANK}`);
    expect(fillConsent('Course: {course_name}', { ...all, course_name: null })).toBe(`Course: ${BLANK}`);
    expect(fillConsent('Name: {patient_name}', { ...all, patient_name: '  ' })).toBe(`Name: ${BLANK}`);
    expect(fillConsent('{nonsense}', all)).toBe(BLANK);
    expect(BLANK).toBe('__________');
  });

  it('replaces every occurrence and leaves other braces alone', () => {
    expect(fillConsent('{file_no}/{file_no} {not a placeholder}', all)).toBe('F-12/F-12 {not a placeholder}');
  });
});

describe('renderConsent', () => {
  it('renders headings, bold, lists and paragraphs with line breaks', () => {
    const html = renderConsent('**Title**\nLine two\r\n\r\n### About\nText\n\n- one\n- two\n\n☐ Yes ☐ No');
    expect(html).toBe(
      '<p><strong>Title</strong><br>Line two</p><h3>About</h3><p>Text</p><ul><li>one</li><li>two</li></ul><p>☐ Yes ☐ No</p>',
    );
  });

  it('escapes HTML in the text and in filled values', () => {
    const html = renderConsent(fillConsent('Name: {patient_name}', { patient_name: '<img src=x onerror=alert(1)> & "q"' }));
    expect(html).toBe('<p>Name: &lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;</p>');
  });
});
