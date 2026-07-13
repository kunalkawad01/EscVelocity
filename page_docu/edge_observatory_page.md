# Edge Observatory Page (`/edge-observatory`)

## What It Does
A live health monitor for tradeable edges in Indian markets. Each edge (momentum 12-1,
BB mean reversion, low-vol, delivery accumulation/distribution) is re-measured monthly by
`jobs/measure_edges.py` on rolling 24-month windows with a fixed battery; this page reads
the append-only `edge_measurements` Postgres record and shows, per edge: latest vitals
(annualized edge, hit rate, decile spread, n), a decay chart (edge-over-time line with 95%
CI band; dashed = backfilled, solid = measured live), a derived status
(HEALTHY / FADING / WEAK / DEAD / TOO_NOISY) with the statistical reason, and the full
measurement record table. A methodology card documents the protocol and the honest
caveats (survivorship, single horizon, delivery data from 2025).

## Optimization
- One API call on mount (`GET /api/edges/observatory`) — reads Postgres, day-cached
  server-side, instant. No polling, no scan gates.
- Statuses/trends computed at READ time from immutable rows (`edge_observatory.py`),
  so the ruleset can improve without rewriting history.

## Lessons Learnt
- Measurements are written by a standalone job, never the backend process (CPU/DuckDB
  batch starves uvicorn on Windows — see CLAUDE.md backend lessons).
- `is_backfilled` distinguishes retro-computed history (legit: raw parquet is immutable)
  from readings taken at the time — the chart encodes this as dashed vs solid.
- DuckDB parameterized dates need explicit `CAST(? AS DATE)` in BETWEEN clauses.

## Business Logic
- Status rules (thresholds in `edge_observatory._CFG`): TOO_NOISY < 6 readings;
  DEAD = 6 straight CI-straddles-zero readings with |mean edge| < 3%/yr; FADING = OLS
  slope < 0 at p < 0.10 over last 12 readings while edge still positive; WEAK = latest CI
  includes zero; else HEALTHY.
- Ranking edges (shared decile protocol, `edges/ranking.py`): top-vs-bottom decile,
  21-bar formation steps, 21-day forward returns, bootstrap CI (seed 42).
- Event edges (delivery): signal events vs equal-weight universe baseline; bearish
  (distribution) excess is sign-adjusted so positive = trade worked.
- Methodology changes MUST bump `METHODOLOGY_VERSION` (`edges/base.py`) — history is
  never overwritten.

## Tech Stack
Highcharts (line + arearange CI band, x-zones for backfilled/live), MUI, usePalette /
useTokens design tokens. Backend: `app/routers/edges.py` → `edge_observatory.py` →
`edges/store.py` (psycopg3 pool via app/db.py).

## Suggestions
- ~~REVIVING status~~ — DONE (Phase 3): significant uptrend + positive latest + CI
  straddling zero, checked before DEAD. bb_meanrev now reads REVIVING.
- ~~Edge-health badges on the Portfolio Builder~~ — DONE (Phase 3): `FIELD_EDGE_MAP` →
  GET `/api/edges/field-health` → warning strips under rule inputs + tinted catalog chips.
- ~~Monthly "State of the Edges" report~~ — DONE (Phase 3): GET `/api/edges/report`
  (deterministic markdown from the record) + copyable section on this page.
- ~~Universe-membership snapshots~~ — DONE (Phase 3): `universe_members` table, recorded
  on every measurement run. Future methodology versions should measure each window on
  its own recorded members.
- IV-based edges (IV premium, EM overpricing): the raw series now accumulates daily via
  `jobs/extract_iv.py` → `data_lake/features/iv_history.parquet` (since 2026-06-15).
  Register an `iv_premium` edge once ~60 sessions exist (~Sep 2026).
- Regime-split measurement (extras) to enable the DORMANT status.
- Report distribution: pipe the monthly markdown to email/Telegram after the measurement run.
