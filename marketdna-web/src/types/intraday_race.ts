export type Category = 'top' | 'bot' | 'rec' | 'dec' | 'neu'
export type DataMode = 'live' | 'eod_fallback' | 'snapshot'

export interface IntradaySymbol {
  symbol: string
  ltp: number
  prev_close: number
  return_pct: number
  rank: number
  prev_rank: number
  atr2: number
  category: Category
  norm_return: number
}

export interface IntradayReturnsResponse {
  as_of: string
  market_open: boolean
  data_mode: DataMode
  replay_source?: 'kite' | 'eod'
  symbols: IntradaySymbol[]
}

export interface NormHistoryResponse {
  price_at_915: Record<string, number>
  times: string[]
  series: Record<string, number[]>
  categories: Record<string, Category>
}
