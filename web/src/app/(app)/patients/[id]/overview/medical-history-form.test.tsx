import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { MedicalHistory } from '@/lib/patients/types';

vi.mock('./actions', () => ({ saveMedicalHistory: vi.fn() }));
import { MedicalHistoryForm } from './medical-history-form';

const history: MedicalHistory = {
  patient_id: 'p1', allergies: '', medications: '', smoking: null, cigarettes_per_day: null, diabetes_status: 'yes',
  hba1c: null, hba1c_date: null, bisphosphonates_status: 'no', anticoagulants_status: null, radiotherapy_status: null,
  osteoporosis_status: null, periodontitis_history: null, bruxism: null, previous_implant_failure: null,
  other_conditions: '', notes: '', updated_at: '2026-10-17T10:00:00Z',
};

describe('<MedicalHistoryForm>', () => {
  it('shows each risk factor as Yes / No / Not assessed, pre-selecting the saved answer', () => {
    render(<MedicalHistoryForm history={history} />);
    expect(within(screen.getByRole('radiogroup', { name: 'Diabetes' })).getByLabelText('Yes')).toBeChecked();
    expect(within(screen.getByRole('radiogroup', { name: 'Bisphosphonates' })).getByLabelText('No')).toBeChecked();
    expect(within(screen.getByRole('radiogroup', { name: 'Bruxism / parafunction' })).getByLabelText('Not assessed')).toBeChecked();
    expect(screen.getByText('7 of 9 not assessed')).toBeInTheDocument();
  });

  it('asks cigarettes per day only for a current smoker', () => {
    render(<MedicalHistoryForm history={history} />);
    expect(screen.queryByLabelText('Cigarettes per day')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Smoking' })).getByLabelText('Current'));
    expect(screen.getByLabelText('Cigarettes per day')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Smoking' })).getByLabelText('Former'));
    expect(screen.queryByLabelText('Cigarettes per day')).not.toBeInTheDocument();
  });

  it('has HbA1c value and date fields', () => {
    render(<MedicalHistoryForm history={{ ...history, hba1c: 7.1, hba1c_date: '2026-09-01' }} />);
    expect(screen.getByLabelText('HbA1c (%)')).toHaveValue('7.1');
    expect(screen.getByLabelText('HbA1c date')).toHaveValue('2026-09-01');
  });
});
