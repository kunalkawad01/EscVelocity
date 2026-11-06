# Clusters Page (`/clusters`)

## What It Does

Two things in one page:

1. **On-demand PDF generation** — two buttons ("FNO Returns Report", "Cluster
   Report") that kick off the existing daily report scripts as background
   jobs, poll for completion, and surface a download link. Exists so the
   trader never has to remember/type the CLI commands
   (`scripts/generate_fno_pdf_report.py`, `scripts/generate_fno_cluster_report.py`).
2. **Live cluster-grouped chart grid** — every F&O underlying (~209 symbols),
   grouped into K-Means clusters by return profile, each group rendered as a
   section of live `ChartTile`s (the same component `/charts` uses) instead
   of one flat alphabetical grid.

## Optimization

- The PCA + K-Means snapshot is cached per calendar date in-process
  (`fno_cluster_service._cache`, same pattern as every other day-cache in
  this codebase) — first load computes (~1-2s for 209 symbols), every
  reload that day is instant. "Recompute" button forces a fresh run.
- Report generation jobs run in a background thread
  (`fno_reports_jobs.py`) so the POST returns immediately; the frontend
  polls `/status` every 3s only while `state === "running"`.
- Chart tiles reuse `/charts`' existing lazy-mount (`useInView`) and shared
  websocket tick (`useFoTicker`) — no new live-data infrastructure.

## Lessons Learnt

- **Single source of truth for clustering logic.** The core analysis
  (symbols → EOD returns → StandardScaler → PCA → K-Means) originally lived
  only in the CLI script. Refactored into `app/services/fno_cluster_service.py`
  so both the PDF (`scripts/generate_fno_cluster_report.py`, which now
  imports from the service via `sys.path.insert(0, BACKEND_DIR)`) and the
  `/api/fno-reports/cluster-snapshot` endpoint compute identically — the
  live page and the PDF can never show different cluster assignments.
- **Report-generation jobs stay subprocess-based, not refactored in-process**,
  unlike the cluster analysis. `generate_fno_pdf_report.py` makes live HTTP
  calls back to `127.0.0.1:8000` (the very server handling the trigger
  request) for intraday Kite data — running it as a separate OS process via
  `subprocess.run(sys.executable, ...)` avoids any same-process self-call
  weirdness and keeps report logic in one script instead of duplicated in a
  service.
- A PDF held open in another app (Acrobat, a browser viewer) locks the file
  on Windows — regeneration then fails with `PermissionError`, surfaced
  correctly through the job's `error` field and rendered in the button card.
  Known, acceptable: the generate button's job-status error display exists
  exactly for cases like this.

## Business Logic

- Features: gap-inclusive close-to-close % returns over 1D/5D/1M(20d)/3M(60d)/1Y(252d),
  `StandardScaler`-normalized before PCA/K-Means (Core Principle 3: `random_state=42`).
  Symbols lacking full 1Y history are excluded (`excluded` count shown in the UI).
- K-Means `k` is swept 3–7 and chosen by best silhouette score — not fixed,
  so cluster count can shift day to day as return dispersion changes.
- Clusters are relabeled A, B, C… by descending mean 1Y return (not K-Means'
  arbitrary internal label order), so "Cluster A" always means strongest
  long-term momentum, consistent between the PDF and the page.
- `characterize()` turns each cluster's mean short-term (1D+5D)/2 vs.
  long-term (3M+1Y)/2 return into one of 7 plain-English labels (e.g.
  "Broad-based uptrend, momentum intact") — same heuristic, same wording,
  in both the PDF and the page.

## Tech Stack

- Backend: `app/services/fno_cluster_service.py` (DuckDB + pandas + scikit-learn:
  `StandardScaler`, `PCA`, `KMeans`, `silhouette_score`), `app/services/fno_reports_jobs.py`
  (subprocess + threading job runner), `app/routers/fno_reports.py`,
  `app/models/fno_reports.py`.
- Frontend: `src/pages/ClustersPage.tsx`, `src/api/fnoReportsApi.ts`,
  `src/types/fnoReports.ts`. Reuses `ChartTile`, `useFoTicker`, `useInView`,
  `useChartsCart`, `chartsCommon` from the `/charts` page — no duplicated
  chart-tile code.
- No new runtime dependency — scikit-learn, matplotlib, reportlab were
  already in `requirements.txt`.

## Suggestions

- The returns-report job has a hard 20-minute subprocess timeout
  (`_TIMEOUT_SEC` in `fno_reports_jobs.py`); if live Kite intraday fetches
  ever regress in latency, surface a progress indicator (tiles fetched /
  209) rather than a silent spinner.
- Job status is in-process only — a backend restart mid-generation loses
  the "running" state (the subprocess itself is also orphaned). Low risk
  today since nobody restarts the backend while a report is generating, but
  worth a PID-file check if that becomes common.
- Consider an "download most recent" affordance that doesn't require
  triggering a fresh generation first, by listing existing dated PDFs in
  `reports/` on load.
