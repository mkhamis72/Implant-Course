// Result types shared by run.ts, quality.ts and wording.ts.

import type { KmFit } from '@/lib/research/stats'
import type { Method, View } from './choose'
import type { MissingReason } from './observations'
import type { Descriptives } from './tests'
import type { TimepointKey } from './timepoints'

export type { Method, View }

export type GroupSummary = {
  /** null = factor not assessed (shown, never tested). */
  level: string | null
  label: string
  n: number
  patients: number
  stats: Descriptives | null
  /** For a categorical outcome: implants per outcome level value. */
  counts?: Record<string, number>
  tested: boolean
}

export type TestResult = { name: string; statistic: string; p: number }
export type Effect = { name: string; value: number; lo?: number; hi?: number }
export type SurvivalCurve = { label: string; fit: KmFit; at12: number | null; at24: number | null }
export type TrendPoint = { label: string; window: TimepointKey; n: number; median: number; q1: number; q3: number }

export type Missing = Partial<Record<MissingReason | 'factor_not_assessed', number>>
