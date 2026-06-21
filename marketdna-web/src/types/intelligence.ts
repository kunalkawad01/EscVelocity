export interface SupplyChainStage {
  stage: string
  players: string
}

export interface SCRisk {
  risk: string
  severity: 'HIGH' | 'MEDIUM' | 'LOW'
  desc: string
}

export interface ClientType {
  name: string
  pct: number
}

export interface Competitor {
  name: string
  share_pct: number
}

export interface PorterForce {
  score: number
  desc: string
}

export interface Porter {
  rivalry: PorterForce
  buyer_power: PorterForce
  supplier_power: PorterForce
  new_entrants: PorterForce
  substitutes: PorterForce
}

export interface Margins {
  gross_margin_co: number
  gross_margin_industry: number
  gross_margin_market: number
  ebitda_margin_co: number
  ebitda_margin_industry: number
  ebitda_margin_market: number
  pat_margin_co: number
  pat_margin_industry: number
  pat_margin_market: number
}

export interface Predictor {
  name: string
  why: string
}

export interface IntelligenceData {
  company: string
  ticker: string
  tagline: string
  what_they_do: string
  sector: string
  industry: string
  sub_industry: string
  industry_keywords: string[]
  supply_chain: SupplyChainStage[]
  company_position_in_sc: string
  sc_risks: SCRisk[]
  client_types: ClientType[]
  client_concentration: 'CONCENTRATED' | 'MODERATE' | 'DIVERSIFIED'
  client_concentration_note: string
  top_clients_examples: string[]
  market_leader: boolean
  market_rank: string
  market_share_pct: number
  main_competitors: Competitor[]
  porter: Porter
  sector_growing: boolean
  sector_cagr_pct: number
  sector_growth_drivers: string[]
  sector_stage: 'EARLY' | 'GROWTH' | 'MATURE' | 'DECLINING'
  margins: Margins
  tailwinds: string[]
  headwinds: string[]
  predictors: Predictor[]
  _cache: 'hit' | 'miss'
}

export interface LiveQuote {
  ticker: string
  last_price: number | null
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  net_change: number | null
  pct_change: number | null
  volume: number | null
  avg_price: number | null
  oi: number | null
  oi_day_high: number | null
  oi_day_low: number | null
  buy_qty: number | null
  sell_qty: number | null
  upper_circuit: number | null
  lower_circuit: number | null
  bid: number | null
  ask: number | null
}

export interface Fundamentals {
  ticker: string
  high_52w: number | null
  low_52w: number | null
  avg_vol: number | null
  last_close: number | null
  ret_1y_pct: number | null
  realised_vol_pct: number | null
  trading_days_1y: number | null
  error?: string
}
