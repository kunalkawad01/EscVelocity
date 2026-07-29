# Research Copilot — `/research-copilot`

Phase 1 of the Research Copilot / Live Agent programme. Full architecture in
`RESEARCH_COPILOT_SPEC.md` at repo root.

## What It Does

A quantitative research assistant over the `equities_prices` OHLCV lake. The user
asks in plain English ("all stocks below 20 RSI", "profile RELIANCE"); an Anthropic
tool-use loop selects deterministic tools, and the page renders the answer plus the
result tables/EDA and an expandable **computation manifest** ("how this was computed").

The LLM never computes a number — it always calls a tool. This is a fresh loop,
separate from the legacy per-symbol assistant (`/api/stock/{symbol}/chat`).

Phase-1 tools: `query_data`, `load_prices`, `compute_indicators`, `compute_stats`,
`screen`, `eda_profile`, `make_chart`.
Phase-2 tools (research surface): `backtest`, `event_study`, `ranking`.
Phase-3 tool (escape hatch): `run_python` — sandboxed Python for open-ended analysis
no pre-built tool covers.
Phase-4 tools (robustness): `optimize`, `walk_forward`, `monte_carlo`. (Live Agent is
the remaining phase.)

## Optimization

- **Bulk-load, never per-symbol.** `screen` loads the whole universe in one DuckDB
  query grouped in Python (CLAUDE.md bulk pattern), then computes indicators in
  vectorized numpy. Never one query per symbol.
- **Deterministic cache** keyed by `(tool, canonical-input, data_version)` — identical
  inputs return identical bytes. `data_version` is a cheap `COUNT(*) + MAX(date)` hash,
  so the cache self-invalidates once per day after ingestion.
- **Benchmark proxy cached** — the equal-weighted `AVG(close)` market index is computed
  once per data_version and reused across correlation ops.
- TA-Lib used when present; pure-numpy Wilder fallbacks for RSI/ATR/SMA/EMA so the
  service runs even if TA-Lib is unavailable.

## Lessons Learnt

- **Cold full-universe parquet scan is heavy.** The 504-file hive glob is slow on first
  touch; rely on the startup view registration (`duckdb_client`) so the first HTTP
  request isn't the one paying for it. A future optimization is a nightly precomputed
  indicator snapshot parquet (`data_lake/derived/research/`) for the screen fields.
- **RSI must stay 0–100.** Validated the Wilder fallback against TA-Lib on RELIANCE/TCS/
  HDFCBANK — min/max within [0,100], values match TA-Lib's smoothing.
- **`screen` value can be a field reference.** To support `ema_20 > ema_50`, a criterion
  `value` may be another field name (resolved per symbol), not just a number.
- **Manifest is the product.** Every response carries `data_version`,
  `methodology_version`, and per-step tool/input/hash/ms — the audit trail is what
  differentiates this from a chatbot. Bump `METHODOLOGY_VERSION` on any formula change.
- **Self-contained backtester over blind vectorbt.** vectorbt's exact API (1.1.0) was
  uncertain, so Phase 2 uses a numpy event-driven engine — fully deterministic and
  unit-tested in-repo (EMA20/50 on RELIANCE/TCS/INFY gave sane CAGR/Sharpe/DD; RSI-cross
  event study n=114, ~57% hit). Cross-checking against vectorbt is a later, optional add.
- **event_study cross detection uses rising edges.** Threshold events fire on the bar a
  condition flips false→true, not on every bar it stays true — otherwise occurrences
  balloon and forward-return stats double-count overlapping windows.
- **Sandbox config via JSON file, never str.format.** The child harness is full of literal
  `{}` (dict literals); formatting parameters in would corrupt it. Parameters go in a
  sibling `cfg.json` the child reads from `argv[1]`. Verified escapes are blocked at the
  AST layer (`import os`, `open`, `().__class__`, `eval`, `from subprocess`) and `con`
  rejects non-SELECT at runtime; a safe snippet on RELIANCE returned correct stats.
- **Windows memory cap gap.** `resource.setrlimit` is POSIX-only; on Windows the sandbox
  relies on the 20s timeout alone for runaway protection. Acceptable for a single-user
  research tool; revisit (job objects / container) before multi-tenant exposure.
- **monte_carlo needs a live handle.** Handles live in `rb._HANDLES` (in-process dict) and
  are lost on restart — the chat flow works because `backtest` runs earlier in the same
  agent turn. If exposing monte_carlo standalone, persist handles or accept a full strategy
  spec instead of a ref.
- **Walk-forward is the real test, and it shows.** Validated EMA20/50 on RELIANCE: optimize
  favored (20,50) in-sample (Sharpe 0.30), but walk-forward exposed a fold whose IS-positive
  params went OOS Sharpe −0.51 — exactly the curve-fit the tool exists to catch. Always read
  the OOS column, never the optimize output, as the edge estimate.

## Business Logic

- **Field grammar** (screen / backtest / event_study): `close, volume, rsi_<n>,
  sma_<n>, ema_<n>, atr_<n>, ret_<n>` (n-day % return), `vol_<n>` (annualized %),
  `volume_ratio_<n>, atr_percentile_<n>, above_sma_<n>, dist_52w_high, dist_52w_low`.
  Ops: `< <= > >= == between`. `value` may be another field name (crossovers).
- **Backtest** (`research_backtest.py`): long-only, event-driven numpy engine. Entry
  rules ANDed, exit rules ORed; ATR or % stop; costs applied both sides. Portfolio =
  equal-weight average of per-symbol equity curves. Stats: CAGR, Sharpe (ann. from
  daily equity returns), max DD, win rate, profit factor, expectancy, avg holding.
  Registers a result `handle` for Phase-4 monte_carlo. Deterministic — no vectorbt
  dependency (vectorbt can be added purely as a cross-check).
- **event_study**: supports `rsi_cross_above/below`, generic `cross_above/below`
  (field vs ref), `new_high`, and threshold (`field op value`, rising edge). Forward
  returns at horizons [5,10,20] across the whole universe; `direction:'bearish'`
  sign-flips returns so positive = setup worked; flags samples below `min_occurrences`.
- **ranking**: `momentum_12_1` is 12-1 skip-one (t-252→t-21, excludes last month — no
  reversal bias); `volatility` ranks low-vol high; `quality`/`relative_strength` blend
  momentum+6m return+drawdown; `composite` takes user weights. All z-scored cross-section.
- **optimize / walk_forward** (`research_optimize.py`): strategy templates use `$placeholders`
  (e.g. `ema_$fast`); `grid` maps each to a value list. `optimize` runs a backtest per combo
  (capped at 60), returns best by sharpe/cagr/calmar + full grid, always with an overfit
  warning. `walk_forward` rolls train/test windows (default 3y/1y): optimize in-sample →
  apply winning params out-of-sample → report per-fold IS vs OOS + degradation. Trust OOS.
- **monte_carlo**: takes a backtest `handle` (from `rb._HANDLES`), bootstraps/shuffles the
  realized trade sequence (seed 42, deterministic), returns total-return + max-DD percentiles
  and probability of loss. The `backtest` tool must run first to produce the handle.
- **run_python sandbox** (`research_sandbox.py`): the escape hatch for open-ended asks.
  Runs in a SEPARATE process with (1) AST validation — no dunder access, no non-whitelisted
  imports, no open/eval/exec/getattr etc.; (2) restricted builtins + whitelist-only
  `__import__`; (3) read-only `df` (pandas long-format for requested symbols) + `con`
  (DuckDB cursor that only permits SELECT/WITH); (4) 20s wall-clock + 1 GB POSIX memory
  cap (cap skipped on Windows — documented gap); (5) must assign `result`; (6) cached +
  replayable by `(code, data_version)`. Config is passed to the child as a JSON file, not
  string-formatted into the source, so the harness can contain arbitrary braces.
- **compute_stats ops**: returns, log_returns, rolling_return, cumulative_return,
  volatility, std_deviation, zscore, percentile, mean, median, skewness, kurtosis,
  quantiles, autocorrelation, drawdown, correlation, rolling_correlation, covariance,
  rolling_beta.
- **Benchmark** for correlation is an equal-weighted market proxy (documented) unless a
  real symbol is passed as `benchmark`.
- **Transport** is the AICredits gateway (`aicredits.in`) via the **OpenAI SDK** —
  same as `fno_assistant.py`, NOT the Anthropic Messages API. The Anthropic-shaped
  `RESEARCH_TOOLS` are remapped to OpenAI function tools by `to_openai_tools()`.
- **Planner model** is `RESEARCH_MODEL` (default `claude-sonnet-5`, falls back to
  `AICREDIT_MODEL`) — reuses `AICREDIT_API_KEY` / `AICREDIT_BASE_URL`. `MAX_IT = 20`.
  Multi-step research chains need a strong model, hence sonnet-5 not haiku.

## Tech Stack

- Backend: `app/routers/research_copilot.py` (`/api/research/*`),
  `app/services/research_copilot_service.py` (agentic loop + manifest),
  `app/services/research_tools.py` (deterministic tools),
  `mcp_server/research_schemas.py` (TOOLS + dispatch + `to_openai_tools`),
  `app/models/research.py`. OpenAI SDK → AICredits gateway (`claude-sonnet-5`),
  DuckDB (thread-local cursor), numpy, TA-Lib (optional).
- Frontend: `src/pages/ResearchCopilotPage.tsx`, `src/api/researchApi.ts`. MUI +
  `usePalette`/`useTokens` design system, chat UI, screen table + EDA panel +
  collapsible manifest.
- Route: `/research-copilot` in `App.tsx`.

## API

- `POST /api/research/chat` `{question, universe}` → `{answer, manifest, artifacts}`
- `POST /api/research/screen` `{criteria, universe, sort_by, limit}` → deterministic
  screen, bypasses the LLM (for UI presets / fast paths)
- `GET  /api/research/eda/{symbol}` → EDA profile
- `GET  /api/research/data-version` → current data fingerprint
- `POST /api/research/invalidate` → clear the tool cache (add to post-market workflow)

## Suggestions (backlog)

1. **Nightly indicator snapshot parquet** so `screen` over NSE 500 is sub-second cold.
2. **Chart rendering** — wire `make_chart` specs to Highcharts (histograms, rolling-vol
   line, drawdown area) instead of the current numeric EDA panel.
3. **Result-handle store** (Phase 2 prerequisite) so a screen result can feed a backtest
   in the next turn.
4. **Streaming** the planner's final text for perceived latency.
5. **Add `/api/research/invalidate`** to the CLAUDE.md post-market invalidation loop.
6. Guard against very broad screens (e.g. no criteria) — enforce a max universe scan.
