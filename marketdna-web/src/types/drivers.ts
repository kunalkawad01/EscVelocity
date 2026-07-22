// Types for the Stock Drivers content layer — mirrors app/models/drivers.py.
// Backend serves with response_model_exclude_none, so optional fields are absent
// (not null) when unset.

export type DriverCategory =
  | 'demand'
  | 'policy'
  | 'orders'
  | 'input_costs'
  | 'competition'
  | 'ownership'
  | 'catalyst'

export type DriverWeight = 'primary' | 'secondary' | 'background'

export type ReviewCadence = 'monthly' | 'quarterly' | 'half_yearly' | 'yearly'

export interface DriverEvent {
  event_date: string // 'YYYY-MM-DD' or 'YYYY-MM' if day unknown
  label: string
  observed_move?: string
}

export interface LeadingIndicator {
  name: string
  source: string
  cadence: string
  lead: string
}

export interface DriverForecast {
  how: string
  leading_indicators: LeadingIndicator[]
  rule_of_thumb?: string
}

export type LiveMetricKey = 'atm_iv_percentile' | 'futures_basis'

// Step-6 wiring: binds a driver card to a live metric computed from our own data
export interface DriverLive {
  metric: LiveMetricKey
  label: string
}

// Resolved live metric — computed by the backend at request time
export interface LiveValue {
  metric: LiveMetricKey
  value: number
  unit: string
  detail: string
  as_of: string
}

export interface Driver {
  title: string
  category: DriverCategory
  weight: DriverWeight
  narrative: string
  simple_english: string
  forecast: DriverForecast
  events: DriverEvent[]
  watch?: string
  direction?: string
  verify_note?: string
  as_of?: string
  live?: DriverLive
}

export interface SourceDocument {
  doc_type: 'annual_report' | 'investor_presentation' | 'concall_transcript' | 'filing' | 'other'
  title: string
  period: string
  url?: string
}

export interface StockDriversResponse {
  symbol: string
  company: string
  sector: string
  last_reviewed: string // ISO date
  review_cadence: ReviewCadence
  sources: SourceDocument[]
  drivers: Driver[]
  live_values?: Record<string, LiveValue>
}

// A driver event flattened for the price-chart overlay (carries its parent driver's context)
export interface ChartDriverEvent extends DriverEvent {
  category: DriverCategory
  driver: string
}

export interface DriversCoverageResponse {
  symbols: string[]
  count: number
  errors: string[]
}
