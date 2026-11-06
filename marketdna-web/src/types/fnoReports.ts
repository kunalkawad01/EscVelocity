// Mirrors app/models/fno_reports.py

export interface ClusterSymbolEntry {
  symbol: string
  cluster: string
  pc1: number
  pc2: number
  ret_1d: number
  ret_5d: number
  ret_1m: number
  ret_3m: number
  ret_1y: number
}

export interface ClusterGroup {
  cluster: string
  n: number
  character: string
  mean_1d: number
  mean_5d: number
  mean_1m: number
  mean_3m: number
  mean_1y: number
  symbols: string[] // member symbols, sorted desc by 1Y return
}

export interface ClusterSnapshotResponse {
  as_of_date: string
  k: number
  silhouette: number
  groups: ClusterGroup[]
  items: ClusterSymbolEntry[]
  excluded: number
}

export type ReportJob = 'returns' | 'cluster'
export type ReportJobState = 'idle' | 'running' | 'done' | 'error'

export interface ReportJobStatus {
  job: ReportJob
  state: ReportJobState
  started_at: string | null
  finished_at: string | null
  pdf_filename: string | null
  error: string | null
}
