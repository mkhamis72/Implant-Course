import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../implant-actions', () => ({ fitComponent: vi.fn(), placeImplant: vi.fn(), planImplant: vi.fn(), receiveStockForPlacement: vi.fn() }));
vi.mock('./actions',() => ({ recordConsent: vi.fn(), voidConsent: vi.fn() }));
import { ConsentForm } from './consent-form';
import { recordConsent } from './actions';

const versions = [
  { id: 'v2', label: 'v2', effective_on: '2026-10-01' },
  { id: 'v1', label: 'v1', effective_on: '2026-01-01' },
];

beforeEach(() => {
  vi.mocked(recordConsent).mockReset().mockResolvedValue({});
});

function fill(skip?: string) {
  fireEvent.change(screen.getByRole('combobox', { name: /Language/ }), { target: { value: 'en' } });
  for (const name of ['treatment', 'research', 'teaching_images', 'follow_up']) {
    if (name === skip) continue;
    const group = screen.getByTestId(`consent-item-${name}`);
    fireEvent.click(within(group).getByRole('radio', { name: name === 'research' ? 'No' : 'Yes' }));
  }
  const pdf = new File([new TextEncoder().encode('%PDF-1.7\n')], 'scan.pdf', { type: 'application/pdf' });
  fireEvent.change(screen.getByLabelText(/Signed form/), { target: { files: [pdf] } });
}

describe('ConsentForm', () => {
  it('preselects the current version and leaves the four answers unset', () => {
    render(<ConsentForm patientId="p1" versions={versions} currentVersionId="v2" />);
    expect((screen.getByRole('combobox', { name: /Form version/ }) as HTMLSelectElement).value).toBe('v2');
    expect(screen.getAllByRole('radio')).toHaveLength(8);
    for (const r of screen.getAllByRole('radio')) {
      expect((r as HTMLInputElement).checked).toBe(false);
      expect(r).toBeRequired();
    }
  });

  it('requires all four answers', async () => {
    render(<ConsentForm patientId="p1" versions={versions} currentVersionId="v2" />);
    fill('follow_up');
    fireEvent.submit(screen.getByRole('button', { name: 'Record consent' }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Answer all four items (yes or no).');
    expect(recordConsent).not.toHaveBeenCalled();
  });

  it('sends the answers and the PDF untouched', async () => {
    render(<ConsentForm patientId="p1" versions={versions} currentVersionId="v2" />);
    fill();
    fireEvent.submit(screen.getByRole('button', { name: 'Record consent' }).closest('form')!);
    await waitFor(() => expect(recordConsent).toHaveBeenCalled());
    const [patientId, fd] = vi.mocked(recordConsent).mock.calls[0];
    expect(patientId).toBe('p1');
    expect(fd.get('version')).toBe('v2');
    expect(fd.get('language')).toBe('en');
    expect(fd.get('treatment')).toBe('yes');
    expect(fd.get('research')).toBe('no');
    expect((fd.get('file') as File).name).toBe('scan.pdf');
    expect((fd.get('file') as File).type).toBe('application/pdf');
  });

  it('shows the database refusal', async () => {
    vi.mocked(recordConsent).mockResolvedValue({ error: 'The date signed is before this form version took effect.' });
    render(<ConsentForm patientId="p1" versions={versions} currentVersionId="v2" />);
    fill();
    fireEvent.submit(screen.getByRole('button', { name: 'Record consent' }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('before this form version took effect');
  });

  it('says when the browser cannot process the photo', async () => {
    render(<ConsentForm patientId="p1" versions={versions} currentVersionId="v2" />);
    fill();
    const photo = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'scan.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText(/Signed form/), { target: { files: [photo] } });
    fireEvent.submit(screen.getByRole('button', { name: 'Record consent' }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent("This photo couldn't be processed in this browser. Try another browser, or upload a PDF.");
    expect(recordConsent).not.toHaveBeenCalled();
  });
});
