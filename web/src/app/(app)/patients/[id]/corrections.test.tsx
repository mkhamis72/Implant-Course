import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ChartData, ImplantSite } from '@/lib/inventory/types';

vi.mock('./implant-actions', () => ({
  correctBatch: vi.fn(), correctPlacement: vi.fn(), removePlacement: vi.fn(), voidComponent: vi.fn(), voidFollowup: vi.fn(),
}));
import { Corrections } from './corrections';

const site = {
  id: 's1', tooth: 36, state: 'placed', technique: 'guided', placed_on: '2026-05-02', stock_lot_id: 'l1',
  torque_ncm: 35, isq: 70, bone_type: 'D2', graft: 'Bio-Oss old note', notes: 'first', product: null, lot: null,
  placing_delegate_id: 'gone', assisting_delegate_id: null, supervisor_id: 'sup1', course_id: 'c1',
  placing: { full_name: 'Dr Former' }, assisting: null, supervisor: { full_name: 'Prof A' },
  components: [], followups: [], slot: null, created_at: '2026-05-02T00:00:00Z',
} as unknown as ImplantSite;
const data = {
  inventoryOn: true, teachingOn: true, doctors: [{ id: 'doc1', name: 'Dr Nabil' }], lots: [], implants: [], componentProducts: [],
  delegates: [{ id: 'd1', label: 'Dr Right' }], enrollments: [{ course_id: 'c1', delegate_id: 'd1' }, { course_id: 'c2', delegate_id: 'd1' }],
  supervisors: [{ id: 'sup1', label: 'Prof A' }, { id: 'sup2', label: 'Prof B' }],
  courses: [
    { id: 'c1', name: 'May course', start_date: '2026-05-01', end_date: '2026-05-05' },
    { id: 'c2', name: 'June course', start_date: '2026-06-01', end_date: '2026-06-05' },
  ],
} as unknown as ChartData;

describe('<Corrections> placement details', () => {
  it('is prefilled, keeps an inactive recorded delegate selectable, and sends the corrected values', async () => {
    const { correctPlacement } = await import('./implant-actions');
    vi.mocked(correctPlacement).mockResolvedValue({});
    render(<Corrections patientId="pt" site={site} data={data} />);
    const box = screen.getByRole('group', { name: 'Placement details' });
    expect(within(box).getByLabelText('Placement date')).toHaveValue('2026-05-02');
    expect(within(box).getByRole('combobox', { name: 'Placed by (delegate)' })).toHaveValue('gone');
    expect(within(within(box).getByRole('combobox', { name: 'Placed by (delegate)' })).getByRole('option', { name: 'Dr Former (inactive)' })).toBeInTheDocument();
    expect(within(box).queryByLabelText(/Insertion torque/)).not.toBeInTheDocument();
    expect(within(box).queryByLabelText('ISQ')).not.toBeInTheDocument();
    expect(within(box).queryByRole('combobox', { name: 'Bone type' })).not.toBeInTheDocument();

    expect(within(box).queryByLabelText('Graft')).not.toBeInTheDocument();
    fireEvent.change(within(box).getByLabelText('Placement date'), { target: { value: '2026-05-01' } });
    fireEvent.change(within(box).getByRole('combobox', { name: 'Placed by (delegate)' }), { target: { value: 'd1' } });
    fireEvent.change(within(box).getByRole('combobox', { name: 'Supervisor' }), { target: { value: 'sup2' } });
    expect(within(box).getByRole('combobox', { name: 'Course' })).toHaveValue('c1');
    fireEvent.change(within(box).getByRole('combobox', { name: 'Course' }), { target: { value: 'c2' } });
    fireEvent.click(within(box).getByRole('button', { name: 'Save details' }));
    expect(vi.mocked(correctPlacement)).toHaveBeenCalledWith({
      siteId: 's1', patientId: 'pt', placedOn: '2026-05-01', placedBy: 'delegate', placingDelegateId: 'd1', placingDoctorId: null, assistingDelegateId: '', supervisorId: 'sup2', courseId: 'c2',
      graft: 'Bio-Oss old note', notes: 'first',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Correction saved.');
  });

  // The chart doesn't load enrollments (Patients viewers can't read them), so the report's date-plus-enrollment
  it('lists the course delegates, keeps a recorded active one marked as not enrolled, and clears them on a course change', () => {
    const twoDelegates = {
      ...data,
      delegates: [{ id: 'd1', label: 'Dr Right' }, { id: 'd2', label: 'Dr Visitor' }],
      enrollments: [{ course_id: 'c2', delegate_id: 'd1' }],
    } as unknown as ChartData;
    render(<Corrections patientId="pt" site={{ ...site, placing_delegate_id: 'd2' } as ImplantSite} data={twoDelegates} />);
    const box = screen.getByRole('group', { name: 'Placement details' });
    const placing = within(box).getByRole('combobox', { name: 'Placed by (delegate)' });
    expect(placing).toHaveValue('d2');
    expect(within(placing).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose the delegate…', 'Dr Visitor (not enrolled)']);
    fireEvent.change(within(box).getByRole('combobox', { name: 'Course' }), { target: { value: 'c2' } });
    expect(placing).toHaveValue('');
    expect(within(placing).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose the delegate…', 'Dr Right']);
  });

  // fallback can't be computed here: a placement with no course asks for one.
  it('leaves the course empty on a placement recorded without one', () => {
    render(<Corrections patientId="pt" site={{ ...site, course_id: null } as ImplantSite} data={data} />);
    const box = screen.getByRole('group', { name: 'Placement details' });
    expect(within(box).getByRole('combobox', { name: 'Course' })).toHaveValue('');
  });
});

describe('<Corrections> placed by a doctor', () => {
  it('switches to Doctor and sends the doctor with no delegate', async () => {
    const { correctPlacement } = await import('./implant-actions');
    vi.mocked(correctPlacement).mockClear().mockResolvedValue({});
    render(<Corrections patientId="pt" site={site} data={data} />);
    const box = screen.getByRole('group', { name: 'Placement details' });
    expect(within(box).getByRole('radio', { name: 'Delegate' })).toBeChecked();
    fireEvent.click(within(box).getByRole('radio', { name: 'Doctor' }));
    expect(within(box).queryByRole('combobox', { name: 'Placed by (delegate)' })).not.toBeInTheDocument();
    fireEvent.change(within(box).getByRole('combobox', { name: 'Doctor' }), { target: { value: 'doc1' } });
    expect(within(box).getByRole('combobox', { name: 'Supervisor (optional)' })).toBeInTheDocument();
    fireEvent.click(within(box).getByRole('button', { name: 'Save details' }));
    expect(vi.mocked(correctPlacement)).toHaveBeenCalledWith(expect.objectContaining({
      placedBy: 'doctor', placingDoctorId: 'doc1', placingDelegateId: null,
    }));
  });

  it('starts on Doctor for an implant placed by a doctor, keeping an inactive one', () => {
    render(<Corrections patientId="pt" site={{ ...site, placing_delegate_id: null, placing: null, placing_doctor_id: 'old', doctor: { name: 'Dr Gone' } } as unknown as ImplantSite} data={data} />);
    const box = screen.getByRole('group', { name: 'Placement details' });
    expect(within(box).getByRole('radio', { name: 'Doctor' })).toBeChecked();
    expect(within(box).getByRole('combobox', { name: 'Doctor' })).toHaveValue('old');
    expect(within(box).getByRole('option', { name: 'Dr Gone (inactive)' })).toBeInTheDocument();
  });

  it('in a clinic shows only the doctor: no course, delegate or supervisor', async () => {
    const { correctPlacement } = await import('./implant-actions');
    vi.mocked(correctPlacement).mockClear().mockResolvedValue({});
    const clinic = { ...data, teachingOn: false, delegates: [], supervisors: [], courses: [], enrollments: [] } as unknown as ChartData;
    render(<Corrections patientId="pt" site={{ ...site, placing_delegate_id: null, placing: null, supervisor_id: null, supervisor: null, course_id: null, placing_doctor_id: 'doc1', doctor: { name: 'Dr Nabil' } } as unknown as ImplantSite} data={clinic} />);
    const box = screen.getByRole('group', { name: 'Placement details' });
    expect(box).not.toHaveTextContent(/Supervisor|Course|Delegate/i);
    expect(within(box).queryByRole('radio')).not.toBeInTheDocument();
    expect(within(box).getByRole('combobox', { name: 'Placed by' })).toHaveValue('doc1');
    fireEvent.click(within(box).getByRole('button', { name: 'Save details' }));
    expect(vi.mocked(correctPlacement)).toHaveBeenCalledWith(expect.objectContaining({
      placedBy: 'doctor', placingDoctorId: 'doc1', placingDelegateId: null, assistingDelegateId: null, supervisorId: null, courseId: null,
    }));
  });
});

describe('<Corrections> in a clinic, an implant recorded before the switch', () => {
  it('a delegate placed it: shows none of what it names, no doctor select, and sends it back as recorded (0121)', async () => {
    const { correctPlacement } = await import('./implant-actions');
    vi.mocked(correctPlacement).mockClear().mockResolvedValue({});
    const clinic = { ...data, teachingOn: false, delegates: [], supervisors: [], courses: [], enrollments: [] } as unknown as ChartData;
    render(<Corrections patientId="pt" site={{ ...site, placing_delegate_id: 'd1', assisting_delegate_id: 'd2', placing_doctor_id: null, doctor: null } as unknown as ImplantSite} data={clinic} />);
    const box = screen.getByRole('group', { name: 'Placement details' });
    expect(box).not.toHaveTextContent(/Supervisor|Course|Delegate|Dr Former|Prof A|Doctor|Placed by/i);
    expect(within(box).queryByRole('combobox')).toBeNull();
    fireEvent.change(within(box).getByLabelText('Notes'), { target: { value: 'fixed' } });
    fireEvent.click(within(box).getByRole('button', { name: 'Save details' }));
    expect(vi.mocked(correctPlacement)).toHaveBeenCalledWith(expect.objectContaining({
      placedBy: 'delegate', placingDoctorId: null, notes: 'fixed',
      placingDelegateId: 'd1', assistingDelegateId: 'd2', supervisorId: 'sup1', courseId: 'c1',
    }));
  });
});

describe('<Corrections> product and stock batch', () => {
  const p1 = { id: 'p1', brand: 'Oxy', system: 'PSK', type: 'implant', diameter_mm: 4, length_mm: 10 };
  const p2 = { id: 'p2', brand: 'Oxy', system: 'PSK', type: 'implant', diameter_mm: 4.5, length_mm: 10 };
  const lot = (id: string, product_id: string, on_hand: number) => ({
    stock_lot_id: id, product_id, lot_no: id.toUpperCase(), expiry: null, on_hand, site_id: 'x',
  });
  const base = (over: object, inventoryOn: boolean, lots: object[] = []) => ({
    s: { ...site, product: p1, ...over } as unknown as ImplantSite,
    d: { ...data, inventoryOn, implants: [p1, p2], lots } as unknown as ChartData,
  });

  it('Inventory off, no lot: corrects the product with no batch', async () => {
    const { correctBatch } = await import('./implant-actions');
    vi.mocked(correctBatch).mockResolvedValue({});
    const { s, d } = base({ stock_lot_id: null }, false);
    render(<Corrections patientId="pt" site={s} data={d} />);
    expect(screen.queryByRole('button', { name: 'Attach stock batch' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Correct batch' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Product actually used' }), { target: { value: 'p2' } });
    fireEvent.change(screen.getByLabelText('Reason for correction'), { target: { value: 'Wrong size' } });
    fireEvent.click(screen.getByRole('button', { name: 'Correct product' }));
    expect(vi.mocked(correctBatch)).toHaveBeenCalledWith({
      siteId: 's1', patientId: 'pt', componentId: '', newProductId: 'p2', newLotId: null, reason: 'Wrong size',
    });
  });

  it('Inventory off, with a lot: offers nothing but a note', () => {
    const { s, d } = base({ stock_lot_id: 'l1' }, false);
    render(<Corrections patientId="pt" site={s} data={d} />);
    expect(screen.getByText('Switch Inventory on to correct the stock batch.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Correct product' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Correct batch' })).not.toBeInTheDocument();
  });

  it('Inventory on, no lot: attaches a batch (empty ones included) or corrects the product', async () => {
    const { correctBatch } = await import('./implant-actions');
    vi.mocked(correctBatch).mockResolvedValue({});
    const { s, d } = base({ stock_lot_id: null }, true, [lot('l9', 'p1', 0), lot('l8', 'p2', 3)]);
    render(<Corrections patientId="pt" site={s} data={d} />);
    expect(screen.getByRole('button', { name: 'Correct product' })).toBeInTheDocument();
    const select = screen.getByRole('combobox', { name: 'Stock batch' });
    expect(within(select).getAllByRole('option')).toHaveLength(2);
    fireEvent.change(select, { target: { value: 'l9' } });
    fireEvent.change(screen.getByLabelText('Reason for correction'), { target: { value: 'Late entry' } });
    fireEvent.click(screen.getByRole('button', { name: 'Attach stock batch' }));
    expect(vi.mocked(correctBatch)).toHaveBeenCalledWith({
      siteId: 's1', patientId: 'pt', componentId: '', newProductId: '', newLotId: 'l9', reason: 'Late entry',
    });
  });

  it('Inventory on, with a lot: Correct batch with no batch chosen is stopped on the client', async () => {
    const { correctBatch } = await import('./implant-actions');
    vi.mocked(correctBatch).mockClear();
    const { s, d } = base({ stock_lot_id: 'l1' }, true, [lot('l2', 'p1', 4)]);
    render(<Corrections patientId="pt" site={s} data={d} />);
    fireEvent.click(screen.getByRole('button', { name: 'Correct batch' }));
    expect(await screen.findByText('Choose the correct batch.')).toBeInTheDocument();
    expect(vi.mocked(correctBatch)).not.toHaveBeenCalled();
  });

  it('clears the batch and reason after a saved attach, and disables Correct product for the same product', async () => {
    const { correctBatch } = await import('./implant-actions');
    vi.mocked(correctBatch).mockClear();
    vi.mocked(correctBatch).mockResolvedValue({});
    const { s, d } = base({ stock_lot_id: null }, true, [lot('l9', 'p1', 0)]);
    render(<Corrections patientId="pt" site={s} data={d} />);
    expect(screen.getByRole('button', { name: 'Correct product' })).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Stock batch' }), { target: { value: 'l9' } });
    fireEvent.change(screen.getByLabelText('Reason for correction'), { target: { value: 'Late entry' } });
    fireEvent.click(screen.getByRole('button', { name: 'Attach stock batch' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Correction saved.');
    expect(screen.getByRole('combobox', { name: 'Stock batch' })).toHaveValue('');
    expect(screen.getByLabelText('Reason for correction')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Attach stock batch' })).toBeDisabled();
  });

  it('Inventory on, with a lot: the usual batch correction', () => {
    const { s, d } = base({ stock_lot_id: 'l1' }, true, [lot('l2', 'p1', 4)]);
    render(<Corrections patientId="pt" site={s} data={d} />);
    expect(screen.getByRole('button', { name: 'Correct batch' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Attach stock batch' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Correct product' })).not.toBeInTheDocument();
  });
});

describe('<Corrections> remove an implant entered by mistake', () => {
  it('says what goes with it, asks a second time, then sends the reason', async () => {
    const { removePlacement } = await import('./implant-actions');
    vi.mocked(removePlacement).mockResolvedValue({});
    const withRecords = {
      ...site,
      components: [{ id: 'k1', component_type: 'cover_screw', voided_at: null }, { id: 'k2', component_type: 'healing_abutment', voided_at: 'x' }],
      followups: [{ id: 'f1', voided_at: null, date: '2026-05-20', check_type: 'review', result: 'ok' }],
    } as unknown as ImplantSite;
    render(<Corrections patientId="pt" site={withRecords} data={data} />);
    expect(screen.getByText(/with its 1 component and 1 follow-up visit/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Reason for removing the implant'), { target: { value: 'Wrong tooth' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove implant' }));
    expect(vi.mocked(removePlacement)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove the implant on tooth 36' }));
    expect(vi.mocked(removePlacement)).toHaveBeenCalledWith({ id: 's1', patientId: 'pt', reason: 'Wrong tooth' });
  });

  it('is not offered for a planned implant', () => {
    render(<Corrections patientId="pt" site={{ ...site, state: 'planned' } as unknown as ImplantSite} data={data} />);
    expect(screen.queryByRole('button', { name: 'Remove implant' })).not.toBeInTheDocument();
  });
});
