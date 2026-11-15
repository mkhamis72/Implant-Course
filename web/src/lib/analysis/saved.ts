// A saved Explore analysis is its URL query (url.ts is the serialisation), stored as
// { version: 1, query: { <param>: <string> } } in saved_analyses (0079). Opening it reruns it on today's data;
// parseExplore drops whatever no longer exists.

import { z } from 'zod'
import { RESEARCH_FILTER_KEYS } from '@/lib/research/view'
import { exploreQuery, type ExploreState } from './url'
import { isUuid } from '@/lib/uuid'

export type SavedConfig = { version: 1; query: Record<string, string> }

const KEYS = new Set<string>([...RESEARCH_FILTER_KEYS, 'f', 'o', 'w', 'v', 'alt'])

export const savedConfigSchema = z.object({
  version: z.literal(1),
  query: z.record(z.string(), z.string().max(500))
    .refine((q) => Object.keys(q).every((k) => KEYS.has(k) || /^x_[a-z_]+$/.test(k)), { message: 'Unknown parameter.' })
    .refine((q) => Object.keys(q).length <= 40, { message: 'Too many parameters.' }),
})

export function toSavedConfig(state: ExploreState, base: Record<string, string>, alt: boolean): SavedConfig {
  const query = Object.fromEntries(new URLSearchParams(exploreQuery(state, base).slice(1)))
  if (alt) query.alt = '1'
  return { version: 1, query }
}

export function savedHref(config: SavedConfig): string {
  return `/statistics/explore?${new URLSearchParams(config.query).toString()}`
}

export function savedCourse(config: SavedConfig): string | null {
  const course = config.query.course
  return course && isUuid(course) ? course : null
}
