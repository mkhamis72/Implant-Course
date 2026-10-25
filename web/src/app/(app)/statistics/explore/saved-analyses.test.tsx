import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

vi.mock('./actions', () => ({ saveAnalysis: vi.fn(async () => ({ id: 'new' })), deleteAnalysis: vi.fn(async () => ({})) }))
import { deleteAnalysis, saveAnalysis } from './actions'
import { SavedAnalyses, type SavedRow } from './saved-analyses'
import { chartFileName } from './chart-download'

const ME = 'u-me'
const row = (over: Partial<SavedRow> = {}): SavedRow => ({
  id: 'a1', title: 'Smoking and failure', config: { version: 1, query: { f: 'smoking', o: 'failed' } }, course_id: null,
  created_by: 'u-other', created_at: '2026-10-20T10:00:00Z', creator: { full_name: 'Dr Other' }, ...over,
})
const current = { version: 1 as const, query: { course: 'all', f: 'jaw', o: 'failed', w: 'm12' } }
const props = { canEdit: true, userId: ME, isAdmin: false, courses: {}, current }

beforeEach(() => { vi.mocked(saveAnalysis).mockClear(); vi.mocked(deleteAnalysis).mockClear() })

describe('SavedAnalyses', () => {
  it('says when there is nothing saved', () => {
    render(<SavedAnalyses items={[]} {...props} />)
    expect(screen.getByText('No saved analyses yet.')).toBeInTheDocument()
  })

  it('links each analysis and lets only its creator or an admin change it', () => {
    const { rerender } = render(<SavedAnalyses items={[row()]} {...props} />)
    const item = screen.getByRole('listitem')
    expect(within(item).getByRole('link', { name: 'Smoking and failure' })).toHaveAttribute('href', '/statistics/explore?f=smoking&o=failed')
    expect(within(item).getByText(/by Dr Other/)).toBeInTheDocument()
    expect(within(item).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    rerender(<SavedAnalyses items={[row()]} {...props} isAdmin />)
    expect(within(screen.getByRole('listitem')).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    rerender(<SavedAnalyses items={[row({ created_by: ME })]} {...props} />)
    expect(within(screen.getByRole('listitem')).getByRole('button', { name: 'Rename' })).toBeInTheDocument()
  })

  it('saves the current analysis with a title and shows errors', async () => {
    render(<SavedAnalyses items={[]} {...props} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Jaw and failure' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save analysis' }))
    await waitFor(() => expect(saveAnalysis).toHaveBeenCalledWith(null, 'Jaw and failure', current))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.')
    vi.mocked(saveAnalysis).mockResolvedValueOnce({ error: 'Enter a title for the analysis.' })
    fireEvent.click(screen.getByRole('button', { name: 'Save analysis' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a title for the analysis.')
  })

  it('deletes after a second click', async () => {
    render(<SavedAnalyses items={[row({ created_by: ME })]} {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(deleteAnalysis).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    await waitFor(() => expect(deleteAnalysis).toHaveBeenCalledWith('a1'))
  })

  it('has no save form without Edit', () => {
    render(<SavedAnalyses items={[]} {...props} canEdit={false} />)
    expect(screen.queryByRole('button', { name: 'Save analysis' })).not.toBeInTheDocument()
  })
})

describe('chartFileName', () => {
  it('names downloads by outcome and date', () => {
    expect(chartFileName('bone_change', '2026-10-25', 'png')).toBe('explore-bone_change-2026-10-25.png')
  })
})
