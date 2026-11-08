// 'yesterday' is a valid tf for GET /api/charts/history (the prior completed
// session only, 09:15-15:30) but is deliberately left out of CHARTS_TFS -- it
// powers the Live Screener's 6-timeframe expanded view, not a tab on the
// /charts tile grid, so it must stay out of TF tab lists / cart sections.
export type ChartsTf = '1d' | 'yesterday' | '2d' | '5d' | '1mo' | '3mo' | 'ytd' | '1y' | '5y'

export const CHARTS_TFS: ChartsTf[] = ['1d', '2d', '5d', '1mo', '3mo', 'ytd', '1y', '5y']

// Candle resolution selectable on the 1D tab only -- every other timeframe has one
// fixed interval appropriate to its own lookback (see fno_charts_service.TF_CONFIG).
export type ChartsOneDInterval = '1m' | '5m'
export const ONE_D_INTERVALS: ChartsOneDInterval[] = ['1m', '5m']

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

// GET /api/charts/history-for-date?symbol=X&date=YYYY-MM-DD -- intraday candles
// for one explicit past trading date (not a relative timeframe). Used by Result
// Reaction's per-quarter chart grid to show the actual intraday shape of each
// reaction day (Day -1 through Day +5) around a stock's quarterly results.
export interface ChartsHistoryForDateResponse {
  symbol: string
  date: string
  interval?: string
  candles: ChartsCandle[]
  error?: string
}

// One F&O underlying's latest tick, keyed by symbol in the /ws/charts message.
// open/high/low are TODAY's session so far (Kite MODE_FULL tick's "ohlc" block);
// prev_close is the PREVIOUS day's close -- same quirk fno_charts_service.py relies
// on elsewhere for gap-inclusive returns. Powers the live return filters (vs
// yesterday's close / today's open / today's high / today's low) on
// /charts, /clusters and /chart-cart -- no backend scan needed, just arithmetic
// against whatever tick is already streaming.
export interface ChartsTick {
  ltp: number
  prev_close: number
  change: number
  change_pct: number
  open?: number
  high?: number
  low?: number
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

// GET /api/charts/reference-open?minute=HH:MM -- every F&O symbol's traded price
// at that clock minute today (the first 1-minute candle at or after it), in one
// bulk response. Powers the Live Screener's 9:15-vs-9:18(or other) open-reference
// toggle, a noise-reduced alternative to the raw opening-auction print. A symbol
// is simply absent from `opens` if today's session hasn't reached `minute` yet.
export interface ChartsReferenceOpenResponse {
  minute: string
  opens: Record<string, number>
  computed_at?: string
  error?: string
}

// One symbol's return-percentile breakpoints over the lookback window (see
// ScreenerSymbolStats) -- min/25th/50th/75th/90th/max, all in %.
export interface ReturnPercentileBand {
  min: number
  p25: number
  p50: number
  p75: number
  p90: number
  max: number
}

// One symbol's entry in GET /api/charts/screener-stats: 5-year return-percentile
// bands for both the intraday (open->close) and close-to-close daily return
// series, plus latest SMA20/50/100/200. Powers the Live Screener's "vs own
// percentile" filter mode (compare a live metric against THIS stock's own
// historical distribution, not a fixed % cutoff) and its vs-SMA filter fields.
export interface ScreenerSymbolStats {
  n: number
  intraday: ReturnPercentileBand
  closeToClose: ReturnPercentileBand
  sma: {
    sma20: number | null
    sma50: number | null
    sma100: number | null
    sma200: number | null
  }
}

export interface ChartsScreenerStatsResponse {
  years: number
  stats: Record<string, ScreenerSymbolStats>
  computed_at?: string
  error?: string
}
