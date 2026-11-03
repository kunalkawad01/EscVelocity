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
