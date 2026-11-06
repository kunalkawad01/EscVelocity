import type { ClusterSnapshotResponse, ReportJob, ReportJobStatus } from '../types/fnoReports'

// Relative path so requests go through Vite's dev proxy, like every other API client here.
const BASE = '/api/fno-reports'

function json<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(r.statusText)
  return r.json() as Promise<T>
}

export const fnoReportsApi = {
  getClusterSnapshot: (force = false): Promise<ClusterSnapshotResponse> =>
    fetch(`${BASE}/cluster-snapshot${force ? '?force=true' : ''}`).then(json<ClusterSnapshotResponse>),

  generate: (job: ReportJob): Promise<ReportJobStatus> =>
    fetch(`${BASE}/${job}/generate`, { method: 'POST' }).then(json<ReportJobStatus>),

  getStatus: (job: ReportJob): Promise<ReportJobStatus> =>
    fetch(`${BASE}/${job}/status`).then(json<ReportJobStatus>),

  // Not fetched as JSON -- used directly as an <a href> / window.open target so the
  // browser handles the PDF response (download or inline view) itself.
  downloadUrl: (job: ReportJob): string => `${BASE}/${job}/download`,
}
