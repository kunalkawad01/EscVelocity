export interface Week52 {
  low: number
  high: number
  current: number
}

export interface StockHeatmapEntry {
  symbol: string
  name: string
  is_fno: boolean
  returns: Record<string, number>
  series: Record<string, number[]>
  week52: Week52
  rs_vs_nifty: Record<string, number>
}

export interface SectorHeatmapEntry {
  name: string
  color: string
  momentum_score: number
  breadth: Record<string, number>
  returns: Record<string, number>
  series: Record<string, number[]>
  stocks: StockHeatmapEntry[]
}

export interface SectorHeatmapResponse {
  universe: string
  as_of: string
  nifty_returns: Record<string, number>
  sectors: SectorHeatmapEntry[]
}
