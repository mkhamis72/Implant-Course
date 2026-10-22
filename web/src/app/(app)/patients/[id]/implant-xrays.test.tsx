import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import type { ChartData, ImplantSite } from '@/lib/inventory/types';
import type { Radiograph } from '@/lib/radiographs/radiographs';

vi.mock('./xrays/actions', () => ({ saveRadiograph: vi.fn(), voidRadiograph: vi.fn() }));
vi.mock('./implant-actions', () => ({ fitComponent: vi.fn(), placeImplant: vi.fn(), planImplant: vi.fn(), receiveStockForPlacement: vi.fn() }));
import { ImplantXrays } from './implant-xrays';
import { saveRadiograph } from './xrays/actions';

const site = { id: 's1', tooth: 46, state: 'placed', placed_on: '2026-03-10' } as unknown as ImplantSite;
const xray = (over: Partial<Radiograph>): Radiograph => ({
  id: 'r1', taken_on: '2026-04-01', type: 'periapical', purpose: 'baseline', teeth: [46], link: null, notes: '', updated_at: 't', levels: [], ...over,
});
const data = (radiographs: Radiograph[], editable = true) =>
  ({ sites: [site], radiographs, editable, today: '2026-10-22' }) as unknown as ChartData;

describe('<ImplantXrays>', () => {
  it('lists only X-rays that include the tooth, newest first, with this implant\'s levels', () => {
    const rs = [
      xray({ id: 'a', taken_on: '2026-04-01', levels: [{ site: 's1', tooth: 46, mesial_mm: 0.5, distal_mm: null }] }),
      xray({ id: 'b', taken_on: '2026-09-01', teeth: [46, 47] }),
      xray({ id: 'c', taken_on: '2026-09-15', teeth: [11] }),
    ];
    render(<ImplantXrays site={site} patientId="pt" data={data(rs)} />);
    const cards = screen.getAllByTestId('xray');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('Teeth 46, 47');
    expect(within(cards[1]).getByText('0.5 mm')).toBeInTheDocument();
    expect(within(cards[1]).getByText('—')).toBeInTheDocument();
  });

  it('shows only this implant\'s levels, and Add X-ray only to editors', () => {
    const other = xray({ levels: [{ site: 's2', tooth: 47, mesial_mm: 2, distal_mm: 3 }], teeth: [46, 47] });
    const { rerender } = render(<ImplantXrays site={site} patientId="pt" data={data([other])} />);
    expect(screen.queryByText('2 mm')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add X-ray' })).toBeInTheDocument();
    rerender(<ImplantXrays site={site} patientId="pt" data={data([other], false)} />);
    expect(screen.queryByRole('button', { name: 'Add X-ray' })).toBeNull();
  });

  it('opens the form with the implant\'s tooth ticked', () => {
    render(<ImplantXrays site={site} patientId="pt" data={data([])} />);
    expect(screen.getByText('No X-rays recorded for this tooth.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add X-ray' }));
    expect(screen.getByRole('checkbox', { name: '46' })).toBeChecked();
  });

  it('editing from one implant\x27s tab saves every implant\x27s levels, with mesial and distal in the right columns', async () => {
    vi.mocked(saveRadiograph).mockReset().mockResolvedValue({});
    const s36 = { id: 's36', tooth: 36, state: 'placed', placed_on: '2026-03-10' } as unknown as ImplantSite;
    const s34 = { id: 's34', tooth: 34, state: 'placed', placed_on: '2026-03-10' } as unknown as ImplantSite;
    const r = xray({
      teeth: [34, 36],
      levels: [
        { site: 's34', tooth: 34, mesial_mm: 3, distal_mm: 4 },
        { site: 's36', tooth: 36, mesial_mm: 1.5, distal_mm: 2.5 },
      ],
    });
    const d = { sites: [s34, s36], radiographs: [r], editable: true, today: '2026-10-22' } as unknown as ChartData;
    render(<ImplantXrays site={s36} patientId="pt" data={d} />);
    const row = within(screen.getByTestId('xray')).getAllByRole('row')[1];
    const cells = within(row).getAllByRole('cell');
    expect(cells[1]).toHaveTextContent('1.5 mm');
    expect(cells[2]).toHaveTextContent('2.5 mm');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save X-ray' }));
    await waitFor(() => expect(saveRadiograph).toHaveBeenCalled());
    const input = vi.mocked(saveRadiograph).mock.calls[0][0] as Record<string, unknown>;
    expect(input).toMatchObject({
      mesial_s36: '1.5', distal_s36: '2.5', mesial_s34: '3', distal_s34: '4',
    });
  });
});
