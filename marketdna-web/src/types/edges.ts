// src/types/edges.ts — Edge Decay Observatory

export type EdgeStatus = 'HEALTHY' | 'FADING' | 'REVIVING' | 'WEAK' | 'DEAD' | 'TOO_NOISY'

export interface FieldHealth {
  edge_key: string
  edge_label: string
  status: EdgeStatus
  reason: string
  latest_edge_ann_pct: number | null
}

export interface FieldHealthResponse {
  fields: Record<string, FieldHealth>
  as_of: string
}

export interface EdgeReportResponse {
  period: string
  universe: string
  methodology_version: string
  as_of: string
  markdown: string
}

export interface EdgeLatest {
  period: string
  edge_ann_pct: number | null
  hit_rate: number | null
  decile_spread: number | null
  n_signals: number
  ci_low: number | null
  ci_high: number | null
}

export interface EdgeSeriesPoint {
  period: string
  edge_ann_pct: number | null
  hit_rate: number | null
  n_signals: number
  ci_low: number | null
  ci_high: number | null
  is_backfilled: boolean
}

export interface EdgeCard {
  edge_key: string
  label: string
  kind: 'ranking' | 'event' | string
  blurb: string
  n_readings: number
  status: EdgeStatus
  reason: string
  slope: number | null
  p_value: number | null
  latest: EdgeLatest | null
  series: EdgeSeriesPoint[]
}

export interface ObservatoryResponse {
  universe: string
  methodology_version: string
  as_of: string
  edges: EdgeCard[]
  status_rules: Record<string, number>
}

export interface EdgeMeasurementRow {
  period: string
  window_start: string
  window_end: string
  edge_ann_pct: number | null
  hit_rate: number | null
  decile_spread: number | null
  n_signals: number
  ci_low: number | null
  ci_high: number | null
  extras: Record<string, unknown>
  is_backfilled: boolean
  measured_at: string
}

export interface EdgeHistoryResponse {
  edge_key: string
  label: string
  kind: string
  blurb: string
  universe: string
  methodology_version: string
  status: EdgeStatus
  reason: string
  slope: number | null
  p_value: number | null
  measurements: EdgeMeasurementRow[]
}
