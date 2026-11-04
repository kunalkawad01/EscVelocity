export type ChartsTf = '1d' | '2d' | '5d' | '1mo' | '3mo' | 'ytd' | '1y' | '5y'

export const CHARTS_TFS: ChartsTf[] = ['1d', '2d', '5d', '1mo', '3mo', 'ytd', '1y', '5y']

export interface ChartsSymbolsResponse {
  symbols: string[]
  n: number
}

export interface ChartsCandle {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface ChartsHistoryResponse {
  tf: ChartsTf
  symbol: string
  interval?: string
  candles: ChartsCandle[]
  error?: string
}

// One F&O underlying's latest tick, keyed by symbol in the /ws/charts message.
export interface ChartsTick {
  ltp: number
  prev_close: number
  change: number
  change_pct: number
  ts: string
}

// Pushed once a second over /ws/charts -- every tracked F&O underlying's latest
// tick in one combined message, so the whole grid updates live off one socket.
export interface ChartsWsMessage {
  ticks: Record<string, ChartsTick>
}

// One symbol's RSI(14) / ATR(14-as-%-of-price) / period-return%, computed over the
// candle series for one timeframe -- see ChartsIndicatorsResponse.
export interface ChartsIndicatorEntry {
  rsi: number | null
  atr_pct: number | null
  return_pct: number | null
}

// GET /api/charts/indicators?tf=... -- every F&O symbol's indicators at one timeframe
// in one bulk response, keyed by symbol. Powers the filter bar on /charts and
// /chart-cart without fetching full history client-side just to filter the grid.
export interface ChartsIndicatorsResponse {
  tf: ChartsTf
  indicators: Record<string, ChartsIndicatorEntry>
  computed_at?: string
  error?: string
}
