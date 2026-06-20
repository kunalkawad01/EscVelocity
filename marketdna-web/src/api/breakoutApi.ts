export interface BreakoutRow {
  symbol: string
  live_price: number
  prev_close: number
  change_pct: number
  high_1d:   number | null
  high_2d:   number | null
  high_3d:   number | null
  high_4d:   number | null
  high_5d:   number | null
  high_10d:  number | null
  sma20:     number | null
  sma50:     number | null
  sma200:    number | null
  crossed_1d:   boolean
  crossed_2d:   boolean
  crossed_3d:   boolean
  crossed_4d:   boolean
  crossed_5d:   boolean
  crossed_10d:  boolean
  above_sma20:  boolean
  above_sma50:  boolean
  above_sma200: boolean
  score: number
  closes_20: number[]
  day_spark: number[]
}

export interface BreakoutScanResponse {
  as_of:     string
  count:     number
  kite_live: boolean
  rows:      BreakoutRow[]
}

export const breakoutApi = {
  getScan: async (): Promise<BreakoutScanResponse> => {
    const res = await fetch('/api/breakout/scan')
    if (!res.ok) throw new Error(`Breakout API ${res.status}`)
    return res.json()
  },
}
