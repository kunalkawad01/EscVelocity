# CLAUDE.md — MarketDNA

## Mission

MarketDNA is a quantitative research platform for Indian equities, futures, and options.

The objective is to perform cutting-edge research to:

- Construct high-conviction portfolios
- Trade options with structural edge
- Conduct macro research on Indian markets

MarketDNA must function as:

- Portfolio Construction Research Engine
- Options Intelligence Platform
- Macro Research Layer
- AI-Powered Research Assistant

MarketDNA is NOT:

- A signal-selling service
- A trading bot
- A black-box prediction engine
- A charting platform

---

# System Architecture

Kite Connect
↓
Parquet Data Lake
↓
DuckDB
↓
Polars Feature Engine
↓
Feature Store
↓
Validation Layer (VectorBT)
↓
Research MCP Server
↓
LLM Layer
↓
React Frontend

---

# Technology Stack

## Data Storage

Raw Data:

- Parquet (hive-partitioned: `data_lake/raw/equities/symbol=XXX/data.parquet`)

Analytical Layer:

- DuckDB in-memory (views registered over parquet at server startup via `duckdb_client.py`)

**Registered views** (`app/services/duckdb_client.py` — one shared `_base_con`, per-thread cursors):

| View | Parquet source | Always present |
|------|---------------|----------------|
| `equities_prices` | `data_lake/raw/equities/**/*.parquet` (hive-partitioned) | Yes |
| `delivery_data` | `data_lake/raw/delivery/**/*.parquet` (hive-partitioned) | Only if delivery parquet exists |
| `returns_features` | `data_lake/features/returns.parquet` | Only if file exists |
| `std_deviation_features` | `data_lake/features/std_deviation.parquet` | Only if file exists |

Querying `returns_features` or `std_deviation_features` when the file is absent raises a catalog error — guard with existence check or catch the exception.

Application Layer:

- PostgreSQL (planned — not yet implemented)

Caching:

- In-process Python dict, keyed by date string (current implementation)
- Redis (planned — not yet implemented)

---

## Backend

- Python 3.12+
- FastAPI (port 8000)
- Pydantic v2 + pydantic-settings
- Polars
- DuckDB (in-memory, thread-local cursors on shared base connection)
- NumPy, SciPy, Statsmodels (analytics — in requirements.txt)
- Anthropic SDK (AI Research Copilot)
- LangGraph, LangChain-Ollama (agent experiments — in requirements.txt)
- scikit-learn, arch, hmmlearn (planned — not yet in requirements.txt)

---

## Frontend

- React + Vite (port 5173)
- Material UI
- Highcharts / Highstock (candlestick)
- IBM Plex Sans + IBM Plex Mono fonts

---

## Research

- Polars
- NumPy
- SciPy
- Statsmodels
- VectorBT

---

# Core Principles

1. **Data ≠ Intelligence.** Indicators are not edge. Research creates edge.
2. **LLM is a reasoning layer only.** Never calculates metrics, invents scores, or estimates values. Always queries MCP tools. Data flow: User → LLM → MCP → Feature Store. Never User → LLM → raw OHLC.
3. **Determinism is mandatory.** Given identical inputs, output must always be identical. No randomness, no hidden state. (K-Means: always `random_state=42`.)
4. **Features are the product.** Regime Score, Breadth Score, Stock DNA, Market DNA, Recovery Score, Relative Strength, IV Surface — these are first-class citizens.
5. **Explainability is required.** Every score must expose: formula + components + rationale. No opaque outputs.
6. **Research precedes product.** A feature cannot ship unless: implemented → tested → validated → documented.
7. **Portfolio construction** requires regime context. Options edge comes from volatility mispricing, not directional prediction.

---

# Visual / Asset Task Protocol

Before implementing any visual or asset task (illustrations, icons, SVGs, images, animations), ask these three questions first — do not start coding until answered:

1. **File location** — `public/` (served as `/file.svg`) or `src/assets/` (imported as module)? Inline JSX SVG or external file?
2. **Color strategy** — Use page accent directly? Theme-aware (dark/light variants)? Hard-coded neutrals only?
3. **Illustration concepts** — Specific named illustrations / style references, or free choice? Any placement constraints (hero only, state-specific, mobile hidden)?

Skipping these questions causes multi-round deliberation that burns tokens without producing output.

---

# UI Design System

**Reference implementation: `marketdna-web/src/pages/IndicatorsPage.tsx`**

All pages must follow the Indicators page design system exactly. The full spec lives at `C:\Users\amitk\.claude\skills\ui-design-system.md`.

## Theme Architecture

Two palettes (light/dark) defined in `src/theme/palette.ts`. Never hard-code colors.

```ts
// Always consume via hooks — never hard-code palette values
import { usePalette, useTokens } from '../../hooks/usePalette'
import { useThemeMode } from '../../contexts/ThemeModeContext'

const { INK, INK2, INK3, CYAN, BORDER, BG, PAPER, PAPER2 } = usePalette()
const { CARD, TH, TD, t1, t2, t3, INPUT_SX } = useTokens()
```

## Key Tokens

| Token | Purpose |
|-------|---------|
| `CARD` | borderRadius 16px card wrapper — `sx={{ ...CARD, mb: 3 }}` |
| `TH` | Table header: ALL CAPS, 0.65rem, INK3, PAPER2 background |
| `TD` | Table cell: 0.72–0.8rem, IBM Plex Sans |
| `t1` | Primary metric — 0.875rem bold, INK |
| `t2` | Secondary value — 0.8rem medium, INK2 |
| `t3` | Meta/rank/date — 0.72rem, INK3 |
| `INPUT_SX` | OutlinedInput/Select overrides with CYAN focus border |

## Font Stack

- **All UI**: IBM Plex Sans (`'IBM Plex Sans', sans-serif`)
- **Numbers/tickers**: IBM Plex Mono (`'IBM Plex Mono', monospace`)
- **Decorative only**: Caveat

## Color Semantics

| Meaning | Color |
|---------|-------|
| Bullish / Positive / Win | `#22c55e` |
| Bearish / Negative / Loss | `#ef4444` |
| Warning / Neutral | `#fbbf24` |
| Accent / CTA | `CYAN` from palette |

## Page Layout Pattern

```tsx
// Hero gradient (theme-aware)
background: mode === 'dark'
  ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
  : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`

// Two-column layout
<Grid container spacing={2.5}>
  <Grid item xs={12} lg={5}>  {/* Left: list/scanner */}
  <Grid item xs={12} lg={7}>  {/* Right: detail/analysis */}
</Grid>
```

## Section Heading Pattern

```tsx
function SectionHead({ title, accent, meta }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
      <Box sx={{ width: 3, height: 20, borderRadius: 2, bgcolor: accent }} />
      <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: INK, fontFamily: "'IBM Plex Sans', sans-serif" }}>
        {title}
      </Typography>
    </Box>
  )
}
```

Use distinct accent colors per section: indigo, violet, amber, teal, purple.

## What NOT to do

- Never hard-code `#E4EDFF`, `#0B1829`, or any palette hex directly
- Never put palette constants at module level — they won't react to theme toggle
- Never use `rgba(0,200,255,...)` — always interpolate from `CYAN`
- Never set `MenuProps` without `PaperProps` bgcolor — dropdown transparent on dark theme
- Never use `color: '#CBD5E1'` — use `INK3` instead

---

# Data Architecture

## Raw Data Layer

Contains:

- Equity OHLCV
- Futures
- Options Chains

Location:

data_lake/raw/

Raw data is immutable. Never modify raw data.

Critical: DuckDB date column has `Asia/Calcutta` timezone — always cast:
`STRFTIME('%Y-%m-%d', CAST(date AS DATE))`

---

## Feature Layer

Contains:

- SMA metrics
- Drawdowns
- Relative Strength
- Breadth
- DNA metrics
- Regime Scores
- Volatility surfaces

Location:

data_lake/features/

---

## Derived Layer

Contains:

- Backtests
- Validation outputs
- Research results
- Portfolio analytics

Location:

data_lake/derived/

---

# Standards

**Feature validation** — every metric must pass before shipping: Unit Tests → Data Quality Tests → Forward Return Tests → Decile Analysis → Stability Analysis → Out-of-Sample Validation. Fail: delete it. Never keep a metric because it sounds interesting.

**Data quality** — reject data if: duplicate dates, OHLC invalid (High < Low, negative prices), missing columns, corrupted partitions. Every ingestion run generates a validation report.

**Testing** — no `tests/` directory yet. When writing: create `marketdna-backend/tests/__init__.py`. Run from `marketdna-backend/` with venv active: `.\.venv\Scripts\python.exe -m pytest tests/ -v`. Test files: `test_<module>.py`. Min coverage: 90%.

**Performance** — target < 500ms analytical response. System must support 500+ equities, 5+ years history, full options chain.

**Coding** — mandatory: type hints, Pydantic models (in `app/models/` only), docstrings, logging, tests. Avoid: global state, hidden dependencies, hardcoded values, per-request DuckDB connections. Service files: no FastAPI imports, no HTTP logic.

---

# MarketDNA Core Scores

## Regime Score

Measures structural trend quality per stock.

Inputs:

- Price
- SMA20, SMA50, SMA100, SMA200

Formula: 3 components — price position (40pts), SMA alignment (30pts), SMA slope (30pts).
Slope lookbacks: SMA20=5 bars, SMA50=10 bars, SMA200=20 bars.

Output: 0–100

---

## Breadth Score

Measures market participation across NIFTY 50.

Formula: pct_above_sma20×0.30 + pct_above_sma50×0.40 + pct_above_sma200×0.30

Output: 0–100

Use as a filter on signals: bullish signals have low reliability when Breadth < 40.

---

## Recovery Score

Measures speed of recovery after drawdowns.

Output: 0–100

---

## Relative Strength Score

Measures stock performance relative to benchmark.

Benchmarks:

- NIFTY 50 (equal-weighted 48-stock proxy)
- NIFTY Midcap 150

Computed as rolling 20-day rank across all 48 symbols.

Output: 0–100

---

## Stock DNA Score

Composite score per stock.

Components:

- Regime
- Recovery
- Drawdown
- Relative Strength
- Efficiency

Output: 0–100

---

## Market DNA Score

Composite market health score.

Components:

- Breadth
- Stress
- Leadership
- Regime

Output: 0–100

---

# API Reference

Full specs at `http://localhost:8000/docs`. All routers in `marketdna-backend/app/routers/`.

**Startup pre-warming** (daemon threads, `app/main.py`): cointegration ADF scan · pattern validation (60–180s) · indicator scan · edge summary.

| Router file(s) | Prefix | Key notes |
|---------------|--------|-----------|
| `stock.py` | `/api/stock` | `/symbols`; 20+ `/{symbol}/*` endpoints: `summary`, `ohlcv`, `regime`, `drawdown`, `returns`, `risk`, `analogs` (DTW, pre-cached), `zscore`, `volatility-lab`, `pattern-match`, etc. |
| `assistant.py` | `/api/stock` | POST `/{symbol}/chat` — LLM research assistant |
| `regime.py` | `/api/regime` | `/breadth`, `/snapshot` (all NIFTY 50), `/{symbol}`, POST `/invalidate` |
| `indicators.py` | `/api/indicators` | `/scan` (pre-warmed), `/edge/summary`, `/{symbol}`, `/{symbol}/edge`, POST `/invalidate` |
| `patterns.py` | `/api/patterns` | Pattern names: kebab-case in URL. `/scanner`, `/screener/{pattern}`, `/validation` (pre-warmed, 60–180s cold), `/{symbol}/dna`, `/{symbol}/history`, `/{symbol}/regime-dna`. Valid patterns: Double Bottom · Double Top · Bull Flag · Bear Flag · Head & Shoulders · Inverse H&S · Ascending Triangle · Descending Triangle · Rectangle |
| `markov_options.py` | `/api/markov-options` | `/market` scan is slow (30–60s). `/{symbol}` is fast. POST `/market/invalidate` |
| `cointegration.py` | `/api/cointegration` | `/scan` only — pre-warmed at startup. POST `/invalidate` |
| `delivery.py` | `/api/delivery` | `/summary` (all stocks), `/{symbol}`, POST `/invalidate` |
| `short.py` | `/api/short` | `/intelligence` (fast, loads on mount), POST `/invalidate` |
| `quant_strategies.py` | `/api/quant` | `/scan` (slow 20–40s, should be nightly), POST `/invalidate` |
| `dataviz.py` + `dataviz_analytics.py` + `dataviz_breadth_extra.py` | `/api/dataviz` | NSE 500 universe. Key: `/returns/snapshot?horizon=ret_1d`, `/returns/history/{symbol}`, `/scatter?horizon=1m`, `/breadth/above200-weekly`. Horizons: `ret_1d` → `cagr_5y` (11 total). |
| `stock_health.py` | `/api/stock-health` | GET `/scan` (instant — parquet-backed), GET `/{symbol}` (on-demand, ~1-2s), POST `/scan/invalidate` (forces recompute + parquet refresh), POST `/{symbol}/invalidate`. Scan parquet at `data_lake/derived/stock_health/scan.parquet`. |
| `fno.py` | `/api/fno` | Live F&O tactical dashboard. `/state` (market-state gate), `/universe` (OI positioning scatter rows + grade), `/breadth` (RISK_ON/OFF/NEUTRAL verdict), `/normalized` (9:15 rebased lines), `/optionchain/{symbol}` + `/optionchain/{symbol}/strike-chart`, POST `/invalidate`. Live Kite during market hours, DuckDB EOD fallback otherwise. Reuses `live_trading_service` (quotes, `_iday`, NFO cache, option chain). Frontend polls 5s while LIVE only. |

---

# Lessons Learned

## Data Layer

- DuckDB `date` column stores timezone-aware timestamps — always cast to DATE before string formatting: `STRFTIME('%Y-%m-%d', CAST(date AS DATE))`. Forgetting this causes silent filter mismatches.
- Hive-partitioned parquet requires the view to be re-registered after adding new symbols. `register_views.py` must run before any DuckDB query on new data.
- Equal-weighted 48-stock average is a reasonable NIFTY proxy when index data is unavailable — but document this assumption explicitly in every API response that uses it.
- **Non-hive-partitioned parquet + JOIN blocks partition pushdown.** `delivery_data` is not hive-partitioned, so `LEFT JOIN equities_prices × delivery_data` triggers a full `delivery_data` scan (8–16s) even for a single symbol — DuckDB cannot push the `symbol` filter through the JOIN. Fix: two separate queries + Python merge. Result: 0.65s per symbol.
- **Non-partitioned parquet: bulk-load once, never query per-symbol.** When a parquet file is not hive-partitioned (e.g., `delivery_data`), reading it per symbol (50× calls) = 50 × 8s = 400s. Instead, `SELECT * FROM delivery_data` once into a Python dict `{symbol: {date: value}}`, then all subsequent lookups are instant in-memory. See `delivery_service._load_delivery_data()`.
- **Delivery parquet lags price data by 1–2 trading days.** NSE bhavcopy delivery data is published next-day. The last 1–2 rows of `equities_prices` will always have no matching delivery row. Never use `del_pct[-1]` (last price bar index) for "current delivery" — it will be NaN and default to 0.0. Always use `np.where(~np.isnan(del_pct))[0][-1]` to find the last index with actual delivery data.
- **NSE universe is dynamic — never hardcode symbol lists.** All hardcoded `NIFTY50 = [...]` lists in service files have been replaced with `get_universe()` from `stock_metrics.py`, which queries DuckDB at runtime. This ensures new symbols are automatically included after ingestion without code changes.

## Backend

- **MKL/OpenBLAS thread limits must be set before numpy import on Windows.** `app/main.py` sets `MKL_NUM_THREADS=1`, `OPENBLAS_NUM_THREADS=1`, `OMP_NUM_THREADS=1` via `os.environ.setdefault` at the top of the file, before any other imports. Forgetting this causes the backend to silently hang under concurrent requests on Windows.
- **DuckDB uses thread-local cursors on a shared in-memory base connection.** `duckdb_client.py` creates one `_base_con = duckdb.connect(":memory:")`, registers all views once at import time, then hands each thread its own `_base_con.cursor()` stored in `threading.local`. Threads share the catalog (views) but have independent transaction state. Never open a new `duckdb.connect()` per request.
- **Feature parquet views are registered conditionally at startup.** `returns_features` and `std_deviation_features` views in `duckdb_client.py` are only created if the corresponding parquet files exist. Querying these views when the files are absent raises a catalog error — check existence or catch the exception.
- **Cointegration scan is expensive — always preload at startup.** `cointegration_service.start_preload()` is called in the FastAPI `startup` event to run the ADF-based scan in a background thread. Without this, the first API request blocks for 30–60 seconds.
- **Correlation pre-filter before ADF.** The cointegration engine applies a |Pearson r| ≥ 0.70 filter on log prices before running Engle-Granger tests, eliminating ~65% of pairs cheaply. Always apply a fast pre-filter before expensive statistical tests in pairwise analytics.
- Pydantic models must live in `app/models/` — never define response shapes inline in routers.
- Keep service files pure: no FastAPI imports, no HTTP logic. Routers call services; services call DuckDB.
- **Python background threads starve uvicorn's asyncio event loop on Windows.** When a CPU-intensive background thread (e.g., scipy loops) runs between `time.sleep()` calls, the GIL is held for the full compute window (e.g., 576ms per symbol). Even with `time.sleep(0.05)` between iterations, this yields GIL only 8% of the time, causing 2–5× slowdowns on foreground requests. Fix: either do all precomputation synchronously at startup before the server starts accepting requests, or avoid background threads for CPU-bound work entirely.
- **DuckDB serializes concurrent queries on the shared in-memory connection.** Two threads both querying DuckDB simultaneously effectively run serially. Background prewarm DuckDB queries will block foreground HTTP requests for their full duration. The fix is the synchronous startup prewarm pattern: move all critical caches into the FastAPI `@app.on_event("startup")` handler (runs before uvicorn begins serving), then push only non-critical heavy work (`indicator_edge`, `validation`, `cointegration`) to a daemon background thread.
- **Startup prewarm architecture (current).** `app/main.py` runs these synchronously in `startup()` before accepting connections (total ~30s): `regime_service.get_market_regime_series` → `delivery_service._load_delivery_data` → `delivery_service.preload_all_reports` → `regime_service.get_snapshot` → `indicators_service.get_scan`. Then launches background thread for: `cointegration.start_preload` → `stock_health_service.start_scan_warmup` → `indicator_edge.get_edge_summary` → `validation.run_full_validation`. Order matters: user-visible pages go first in background. `start_scan_warmup()` is non-blocking — it starts its own thread and returns immediately, so it does not delay subsequent background tasks.
- **Regime snapshot: one batch query, not N serial queries.** The original `get_market_snapshot()` ran one DuckDB query per symbol (500 serial calls). Rewritten as `get_snapshot()`: one `WHERE symbol IN (...)` query for all symbols, compute numpy per symbol in Python. Result: 0.51s for 485 stocks (was >60s timeout).
- **Batch equities_prices for delivery preload.** `preload_all_reports()` preloads all 50 delivery symbols with one `WHERE symbol IN (...)` query instead of 50 serial per-symbol queries. Groups result by symbol in Python. Turns ~100s into ~3s.
- **`get_market_regime_series_if_ready()` — non-blocking regime accessor.** Services that can degrade gracefully without regime conditioning (delivery, short) use this instead of `get_market_regime_series()`. Returns `{}` if the series hasn't been computed yet, allowing the service to proceed without blocking. Never call the blocking version from a cached report-build path.
- **`_ensure_delivery_view()` cold scan on first HTTP request.** This function runs `SELECT 1 FROM delivery_data LIMIT 0` to verify the view exists. Even with LIMIT 0, DuckDB reads parquet metadata, which takes ~4s cold. Fix: set `_view_ready = True` inside `_load_delivery_data()` immediately after a successful bulk load — the view is proven to exist by the time the load completes. This eliminates the cold check entirely on first HTTP request.
- **Use a `threading.Lock` for expensive singleton scans.** If multiple threads call `get_cointegration_scan()` before the cache is populated (e.g., HTTP request arrives while background preload is still running), each thread starts its own full ADF computation — tripling GIL pressure and causing timeouts. Pattern: check cache → acquire lock → re-check cache inside lock → compute → release. See `cointegration_service._scan_lock`. Apply this pattern to any scan that takes > 5s.
- **Background prewarm ordering: user-visible pages before heavy analytics.** `_background_prewarm()` runs: cointegration first (~25s, user hits this page), then indicator edge (~13s), then validation (~60-180s). Putting indicator edge first means the GIL is held for 13s before cointegration can finish, causing `/cointegration` to timeout on early requests. Always put the fastest user-visible prewarm first.
- **Cointegration is O(n²) — cap universe at 150 symbols.** With 50 symbols: 1,225 pairs × ADF ≈ 3s. With 150 symbols: 11,175 pairs ≈ 25s. With 500 symbols: 124,750 pairs — untestable. `cointegration_service._MAX_SYMBOLS = 150` caps the universe to the top-150 symbols by data history length. Never expand this without profiling first.
- **`_compute_dna_from_arrays` costs ~2.2s per symbol** (9 historical scanners × ~380 iterations × 0.64ms each on a 2000-bar series). When calling it for multiple symbols in a request, apply a `max_bars` trim (e.g., 600 bars → ~576ms/symbol, 4.75× faster) and limit to top-N candidates. Use for interactive endpoints only; precompute full-history DNA at startup for known universes (e.g., NIFTY50).
- **`_aggregate` requires ≥12 occurrences** — pattern historical scanners with `range(80, n-21, 5)` over 1500 bars produce only 280 candidate windows. At a 2–4% detection rate that is 6–11 occurrences, below the 12-occurrence threshold. Always use ≥2000 bars for endpoints that call `_aggregate`, or bypass `_aggregate` and set your own lower threshold inline.
- **Validation suite (60–180s) must be pre-warmed at startup.** Call `validation_service.run_full_validation()` in a `daemon=True` background thread inside the FastAPI `startup` event. Without this, the first user request to `/api/patterns/validation` blocks for 60–180s. The result is cached in-memory; subsequent calls return in <10ms.
- **Lambda default-arg capture in scanner maps.** When building a `dict` of lambdas inside a loop (`scanner_map = {"Pattern": lambda c=closes, lo=lows: ...}`), always bind the current loop variable via default args. Without default args, all lambdas close over the same variable and compute the wrong symbol's data on the last iteration.
- **Bulk DuckDB → Python groupby pattern eliminates N×M query explosion.** The stock health service originally made 5 DuckDB queries per symbol × 500 symbols = 2,500 serial round-trips (~30 min). Fix: 1 bulk OHLCV query + 3 bulk crash-period queries all with `GROUP BY symbol` → group results into `dict[symbol, list]` in Python → pure-NumPy analytics per symbol. Result: ~35s for 500 symbols (50× speedup). Apply this pattern to any service that currently loops `get_X(symbol)` for many symbols.
- **Extract `_analytics()` to decouple I/O from computation.** Separate DuckDB fetches from NumPy analytics into `_compute(symbol)` (I/O) and `_analytics(symbol, closes, dates, monthly_arr, cr, mkt)` (pure NumPy). `_analytics()` can then be called from both the per-symbol path and the batch path without duplication. See `stock_health_service.py`.
- **Monthly returns can be computed from daily closes — no extra DuckDB query.** The DuckDB query `SELECT LAST(close)/FIRST(close)-1 GROUP BY DATE_TRUNC('month', date)` is equivalent to grouping the already-loaded close array by `date[:7]` (year-month prefix) in Python. This eliminates 500 extra round-trips in the batch path. See `stock_health_service._monthly_returns()`.
- **Parquet-first startup pattern for expensive scans.** After a batch warmup completes, save results to `data_lake/derived/stock_health/scan.parquet`. On the next server restart, load from parquet (< 1s) instead of recomputing. Check `computed_date` column against today: if fresh → `_scan_ready = True` immediately; if stale → serve stale data instantly + recompute in background + save fresh parquet. Expose `POST /scan/invalidate` for forced refresh after end-of-day ingestion. Parquet is ~13 KB for 500 symbols — negligible.

## Frontend

- Theme toggle works only if every component calls `usePalette()` / `useTokens()` at render time — module-level palette constants break dark mode.
- Highcharts requires `stockTools` and `annotations` modules to be imported before chart init or toolbar buttons silently fail.
- `MenuProps.PaperProps` must set `bgcolor: PAPER2` on every Select — otherwise dropdown is transparent in dark mode.
- **File-split without `React.lazy` gives no bundle benefit.** `DataVizAnalyticsSections.tsx` was split from `DataVizPage.tsx` for file-size only — imports are still synchronous. Always pair a file split with `React.lazy` + `Suspense` or the split is cosmetic.
- **Load-on-demand pattern for multi-section pages.** DataVizPage (13 sections) requires an explicit "Load Chart" button in each section — no data fetches on mount. This prevents a cold-start waterfall where 13 parallel requests all fire on page load. Use this pattern on any page with ≥5 independent heavy sections.
- **Shared `<Footer />`** lives at `src/components/Footer.tsx` — add it to every page except LandingPage. LandingPage has its own editorial footer (custom `W` palette + IBM Plex Serif) — never replace it with the shared Footer.
- **Per-item toggle state in `.map()`**: never call `useState` inside a loop. Instead use `useState<Record<string, boolean>>({})` in the parent and toggle with `setX(prev => ({ ...prev, [key]: !prev[key] }))`. Each rendered item reads `state[key]` independently. Use this whenever N dynamically rendered cards each need their own open/closed state.

## ML / Analytics

- `arch` (GARCH) and `hmmlearn` (HMM) are slow on full 5-year history — cache results in the Feature Store, never compute on every request.
- K-Means regime clusters are non-deterministic without `random_state=42` — always fix the seed for reproducibility (Principle 2).
- DTW pattern matching is O(n²) — limit comparison window to 252 trading days max.
- **Pattern DNA confidence is capped by volume confirmation tier**: FULL (all volume conditions) → ceiling 90; PARTIAL (some) → ceiling 78; NONE → ceiling 63 (research-grade only). Never report a pattern with high confidence when volume is absent.
- **Sign-adjust all forward return metrics for bearish signals.** When a signal predicts a price drop, a negative raw return is a WIN. Returning raw (unsigned) returns for bearish signals causes the frontend to color a winning trade RED (negative) and a losing trade GREEN (positive). Fix: multiply all return arrays (`avg_1d`, `avg_1w`, `avg_1m`, timeline entries, distribution buckets) by `sign = -1` for bearish signals before returning. This way positive always means "trade worked" regardless of direction. See `delivery_service._compute_signal_stats`.
- **Edge score frequency denominator must be delivery bars, not price bars.** `frequency = occurrences / total_bars * 100` where `total_bars` should be the count of bars where the signal CAN fire (i.e., bars with delivery data), not total OHLCV bars. Using total price bars (e.g., 1560) when only 354 have delivery data deflates frequency by 4.4×, making edge scores artificially low. Always match the denominator to the valid-signal universe.
- **Short service and delivery service accuracy depend on the same delivery universe.** `short_service` iterates over `_get_delivery_symbols()` and calls `get_delivery_report()` per symbol. Any accuracy bug in the delivery report (e.g., wrong current_delivery_pct, inverted bearish returns) propagates directly into the short candidate scores and squeeze detection. Fix delivery service first; short page is derived from it.

---

# Optimizations

## Query Layer

- DuckDB scans are fast but cold — pre-register all views at server startup, not per request.
- For breadth calculations, query all 48 symbols in one DuckDB scan (single `equities_prices` view with `WHERE symbol IN (...)`) rather than 48 separate queries.
- **DataViz endpoints operate on NSE 500 (not NIFTY 50).** The `/api/dataviz/*` routes cover a 500-symbol universe with 6-year history. Return metrics (ret_1d, ret_5d, ret_20d, ret_50d, ret_1y, ret_2y, ret_3y, cagr_1y, cagr_2y, cagr_3y, cagr_5y) are pre-computed in the `returns_features` parquet view. Do not confuse this wider universe with the 48-symbol NIFTY proxy used in regime/breadth calculations.
- Use Polars for post-DuckDB transforms — it is 5–10× faster than pandas on column operations.

## Caching

- Current cache is in-process Python dict keyed by date string — all scores refresh automatically once per calendar day. This is correct for daily features; it is NOT appropriate for intraday data.
- Redis migration target (not yet implemented): regime scores 1 day / breadth 1 hour / OHLCV 15 minutes. When Redis is added, replace dict caches in service modules with Redis TTL keys.
- Feature Store parquet writes should be append-only with date partitioning — never rewrite full history for incremental updates.
- **Scan result parquet lives in `data_lake/derived/`, not `features/`.** Derived outputs (backtests, scan summaries, portfolio analytics) go in `data_lake/derived/<feature>/`. Do not put them in `features/` (reserved for reusable engineered features like returns, std_deviation). See `data_lake/derived/stock_health/scan.parquet`.
- **Startup prewarm costs ~30s but makes every page instantly responsive.** With the synchronous prewarm pattern (see Backend lessons), startup takes ~30s and the server is ready. Without it, the first request to any page that triggers an expensive compute blocks for 10–60s. The 30s upfront cost is always better than blocking the first user. Run without `--reload` in production — hot reload restarts the prewarm on every file save.

## Frontend

- Virtualize any table with >100 rows (react-window or MUI DataGrid virtualization).
- Lazy-load page-level components with `React.lazy` — IndicatorsPage, MarkovOptionsPage, MarketRegimeDashboard, and DataVizPage (+ DataVizAnalyticsSections) are heavy enough to split.
- Plotly/Highcharts: pass `immutable: true` on data that doesn't change to prevent unnecessary re-renders.

## API

- Batch symbol requests: where the frontend needs data for multiple stocks, expose a bulk endpoint rather than N parallel calls.
- Use `response_model_exclude_none=True` on all FastAPI endpoints to keep payloads lean.

---

# Repository Structure

Root: `C:\Users\amitk\EscVel\`

marketdna-data/            ← data lake (authoritative)
  data_lake/raw/equities/symbol=XXX/
  warehouse/register_views.py
  ingestion/

marketdna-backend/
  app/main.py
  app/routers/         (assistant, stock, patterns, markov_options, quant_strategies,
                        indicators, regime, cointegration, delivery, short, stock_health)
  app/services/
  app/models/
  mcp_server/          (Anthropic tool schemas + dispatch: server.py, tool_handlers.py)
  requirements.txt
  .venv/

marketdna-web/
  src/pages/
  src/components/
  src/api/
  src/types/
  src/hooks/usePalette.ts
  src/theme/palette.ts

page_docu/                 ← frontend page documentation (one .md per page)
agents/                    ← agent experiments
start-marketdna.ps1        ← startup script (see How to Run below)

> Note: `marketdana-data/` (double-a typo) also exists at root — legacy copy, do not use.

---

# How to Run

## Quickstart (from repo root)

```powershell
.\start-marketdna.ps1
```

After startup:
- App:      http://localhost:5173
- API:      http://localhost:8000
- API Docs: http://localhost:8000/docs

## Manual start

**Backend** (from `marketdna-backend/`):
```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

**Frontend** (from `marketdna-web/`):
```powershell
npm run dev -- --host 127.0.0.1
```

---

# Post-Market Close Workflow

Run this every day after NSE market close (~15:35 IST). Order matters.

## Step 1 — Ingest fresh data (from `marketdna-data/` with venv active)

```powershell
# a. OHLCV — incremental, adds today's candle for all 500 NSE symbols (~3 min)
.\.venv\Scripts\python.exe -m ingestion.download_nse500

# b. Delivery — incremental, downloads NSE bhavcopy for NIFTY 50 delivery data (~1 min)
.\.venv\Scripts\python.exe -m ingestion.ingest_delivery

# c. Options chain — ATM ±20 strikes, CE+PE, IV computed, all F&O symbols (~2.5 min)
.\.venv\Scripts\python.exe -m ingestion.ingest_option_chain

# d. Futures — current monthly expiry, basis computed, all F&O symbols (~5 sec)
.\.venv\Scripts\python.exe -m ingestion.ingest_futures
```

Options and futures can run in parallel (separate terminals) while OHLCV is running.
Each script automatically refreshes its DuckDB view on completion.

## Step 2 — Invalidate backend caches (backend must be running on port 8000)

The backend pre-warms all service caches at startup. After ingestion adds new data,
the in-process Python caches are stale and must be flushed so pages pick up today's prices.

```powershell
$endpoints = @(
    "http://localhost:8000/api/stock/invalidate",
    "http://localhost:8000/api/regime/invalidate",
    "http://localhost:8000/api/indicators/invalidate",
    "http://localhost:8000/api/delivery/invalidate",
    "http://localhost:8000/api/short/invalidate",
    "http://localhost:8000/api/cointegration/invalidate",
    "http://localhost:8000/api/markov-options/market/invalidate",
    "http://localhost:8000/api/stock-health/scan/invalidate",
    "http://localhost:8000/api/quant/invalidate",
    "http://localhost:8000/api/options/em-scan/invalidate",
    "http://localhost:8000/api/options/scan/invalidate",
    "http://localhost:8000/api/fno/invalidate"
)
foreach ($url in $endpoints) {
    try {
        $r = Invoke-WebRequest -Uri $url -Method POST -UseBasicParsing -ErrorAction Stop
        Write-Output "$($r.StatusCode) $url"
    } catch {
        Write-Output "ERROR $url — $($_.Exception.Message)"
    }
}
```

After invalidation each page re-queries DuckDB (which reads directly from the fresh parquet
files) on its next request — no backend restart needed.

## Alternative: restart both servers

If you prefer a clean slate (e.g. after a code change), restart instead of invalidating:

```powershell
# Kill servers
(Get-NetTCPConnection -LocalPort 8000 -State Listen).OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }
(Get-NetTCPConnection -LocalPort 5173 -State Listen).OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }

# Restart (backend ~30s prewarm before first request)
Start-Process powershell -ArgumentList "-NoExit -Command cd 'C:\Users\amitk\EscVel\marketdna-backend'; .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
Start-Process powershell -ArgumentList "-NoExit -Command cd 'C:\Users\amitk\EscVel\marketdna-web'; npm run dev -- --host 127.0.0.1"
```

## What each invalidation clears

| Endpoint | Pages affected |
|----------|---------------|
| `/api/stock/invalidate` | All `/stock/:symbol` sub-pages (clears `stock_metrics` + `stock_metrics_advanced` day-caches) |
| `/api/regime/invalidate` | All stock pages, Indicators, regime scores |
| `/api/indicators/invalidate` | Indicators scan, edge summary |
| `/api/delivery/invalidate` | Delivery page, Short page (derived from delivery) |
| `/api/short/invalidate` | Short page candidates + squeeze watch |
| `/api/cointegration/invalidate` | Cointegration page pair scan |
| `/api/markov-options/market/invalidate` | Markov Options market scan |
| `/api/stock-health/scan/invalidate` | Stock Health archetype scanner (recomputes in background) |
| `/api/quant/invalidate` | Quant Strategies scan |
| `/api/options/em-scan/invalidate` | Expected Move page (all symbols scan) |
| `/api/options/scan/invalidate` | OI Buildup scanner |

Per-symbol options caches (`/api/options/{symbol}`) are populated on demand — they pick up
fresh parquet automatically on first request after ingestion, no explicit invalidation needed.

---

# Development Priority Order

Phase 1  — Data Ingestion (done)
Phase 2  — Feature Engine (in progress)
Phase 3  — Validation Framework
Phase 4  — MCP Layer (partial — mcp_server/ built with 8 tools: regime, breadth, drawdown, recovery, relative_strength, stock_dna, market_dna, query_raw_data)
Phase 5  — AI Research Assistant (partial — assistant router + Anthropic SDK integration live; model: claude-haiku-4-5-20251001; MAX_IT=12 tool-use iterations)
Phase 6  — Portfolio Construction Engine
Phase 7  — Options Intelligence
Phase 8  — Macro Research Layer
Phase 9  — Production Deployment

---

# Page Documentation

All frontend pages are documented in `page_docu/` at the repository root.

**Index**: `page_docu/00_index.md`

Each file documents: What It Does · Optimization · Lessons Learnt · Business Logic · Tech Stack · Suggestions.

## Workflow rules

1. Before modifying any page, read its doc file to understand existing business logic.
2. After shipping significant changes to a page, update its doc file — stale docs are worse than no docs.
3. The **Suggestions** section in each doc contains validated, prioritized improvement ideas — use them as a backlog, not as requirements.
4. `indicators_page.md` is the canonical UI reference. When unsure about layout or component patterns, read it first.
5. If a page has no doc file, create one before or alongside your changes using the six-section template: **What It Does · Optimization · Lessons Learnt · Business Logic · Tech Stack · Suggestions**.

---

## Page Quick Reference

Compact facts per page — enough to work on any page without reading source. Full detail in `page_docu/`.

### `/` — LandingPage (~840 lines)
- **Static/mocked** — no API calls. All market data (DNA score, breadth, VIX) are hardcoded placeholders.
- **Custom `W` editorial palette** (sage/moss tones) + IBM Plex Serif font. Do NOT convert to `usePalette()` — the editorial look is intentional.
- 12 sections: Hero → Intelligence strip → Featured module → Module grid → Platform stats → Agents → Philosophy → Pipeline → Tech strip → CTA → Footer.
- `PlatformCard` mock values erode trust — wire to live API when Feature Store is ready.

### `/agents` — AgentsPage (~static)
- **Fully static showcase** — 4 agent cards (Market Regime, Stock DNA, Pattern Edge, Options Flow). No API calls.
- Pulsing "Active" dot is cosmetic only. Agents are not functional until Phase 4 MCP ships.
- No business logic. Business logic note: agent routing + MCP tool selection lives in `mcp_server/`.

### `/cointegration` — CointegrationPage
- **Loads on mount**, single `cointegrationApi.getScan()` call. First load 3–5s (scan), subsequent <100ms (cached).
- Uses `SectionCard` + `StatCard` from `../components/SectionCard` — not the standard `CARD` token.
- SVG illustrations in `public/illustrations/`: `pair-analysis.svg` (hero), `data-scan.svg` (loading), `no-pairs.svg` (error/empty).
- Correlation threshold **|r| ≥ 0.70** (doc shows this dynamically from `scan.correlation_threshold`, not hardcoded).
- Active signal alert: amber banner for pairs with **|Z-score| ≥ 2**.
- API: `cointegrationApi.getScan()` → GET `/api/cointegration/scan`

### `/dataviz` — DataVizPage (~1,025 lines + DataVizAnalyticsSections.tsx)
- **NSE 500 universe** — not NIFTY 50. Pre-computed in `returns_features` parquet view.
- **Load-on-demand**: every section requires an explicit "Load Chart" button. No fetches on mount (prevents 13-request cold waterfall).
- 4 inline sections + 9 in `DataVizAnalyticsSections.tsx` (file split only — not lazy-loaded).
- **11 return horizons**: `ret_1d`, `ret_5d`, `ret_20d`, `ret_50d`, `ret_1y`, `ret_2y`, `ret_3y`, `cagr_1y`, `cagr_2y`, `cagr_3y`, `cagr_5y`.
- Scatter section uses separate horizons: `1w`, `1m`, `3m`, `1y`, `3y`.
- Above 200 SMA chart: reference lines at 20% / 50% / 80%; % vs Count toggle is client-side only.
- API: `datavizApi.getSnapshot()`, `.getHistory()`, `.getScatter()`, `.getAbove200Weekly()`

### `/delivery` — DeliveryPage (~1,664 lines — needs splitting)
- **Loads on mount**. 6 delivery signals: Accumulation, Distribution, High Delivery Up, High Delivery Down, Delivery Spike, Vol+Del Spike.
- **Grading**: A+ (WR ≥ 65%, EV ≥ 3%, n ≥ 15) / A / B / C / D (< 50% or n < 5). Grades shared with ShortPage but defined separately — should be centralized.
- **Intent panel**: Buy / Short / Hold / Square Long / Square Short / Explore — derived from signal + regime combination.
- Regime conditioning: signal WR is meaningfully different at regime ≥ 60 vs < 60.
- Charts: Highcharts column, spline, dual Y-axis (DeliverySparkline, VolumeSparkline), scatter (TimelineChart).
- API: `deliveryApi.getSymbol(symbol)`, `deliveryApi.getScan()`

### `/indicators` — IndicatorsPage (reference UI)
- **5 sections**: Market Regime & Breadth (`MarketRegimeDashboard`), Market Indicator Scan, Edge Summary Table (`EdgeSummaryTable`), Indicator Edge Lab (`IndicatorEdgeLab`), Stock Detail.
- **3 layout modes**: Classic (stacked), Focused (tabs via `TabBar`), Split (sticky scanner left / detail right).
- `ScanSection` filters: Overall Signal, RSI, MACD Cross, Trend — all client-side, no re-fetch.
- Clicking a scan row pre-loads the symbol into StockDetailSection; behavior differs by layout mode.
- API: `indicatorsApi.scan()`, `indicatorsApi.getSymbol(symbol)`

### `/markov-options` — MarkovOptionsPage
- **6-regime Markov classifier**. Stock analysis loads immediately on mount. Market scan requires "Run Market Scan" (30–60s).
- SVG illustrations in `public/illustrations/`: `computing-regimes.svg` (loading), `markov-chain.svg` (hero), `market-scan.svg` (scan gate).
- Anchored navbar: `<Navbar sections={[{ label: 'Stock', anchor: 'stock-analysis' }, { label: 'Market', anchor: 'market-overview' }]} />`
- Regime distribution chips in `MarketOverview` are **clickable filters** (toggle `filterRegime`).
- Transition matrix Dirichlet prior: α=0.20. Cells with n<3 shown in yellow.
- API: `markovOptionsApi.getSymbol(symbol)`, `markovOptionsApi.getMarket()`

### `/pattern-dna` — PatternDNAPage (~2,364 lines — largest page, do not add inline)
- **9 patterns**, 4-step validation suite (occurrence check → OOS split → decile analysis → confidence calibration).
- 4 sections: `PatternScanner` (multi-filter), `PatternScreener` (ranking per pattern), `ConfirmedFormingScreener` (Run Scan gate — slow), `ValidationSection`.
- `ConfRing`: inline SVG confidence ring — extract to `src/components/shared/` before adding more uses.
- Highcharts Highstock candlestick with `plotBands` (formation zone) and `plotLines` (support/resistance/target).
- Stage colors: Confirmed `#22c55e`, Breakout Watch `#f59e0b`, Maturing `#60a5fa`, Forming `#94a3b8`.
- API: `patternApi.scan()`, `patternApi.getStock(symbol, pattern)`, `patternApi.validate(pattern)`

### `/pattern-dna-guide` — PatternDNAGuidePage (~477 lines)
- **Fully static** — no API calls. Educational documentation for PatternDNA module.
- Uses **standalone `<DocNavbar>`** (not main app Navbar). Do not add main Navbar here.
- Own component set: `SectionCard`, `TableCard`, `StatusChip`, `Note` — not standard design tokens.

### `/quant-strategies` — QuantStrategiesPage (~881 lines)
- **Single API call** returns all 4 modules simultaneously. Explicit "Run Scan" gate (20–40s). Should be pre-computed nightly.
- **4 modules**: Momentum (12-1 skip-one return), Mean Reversion (BB Z-score + RSI deviation), Vol Rank (HV20 percentile vs 252d), Sector Rotation (RRG quadrants: Leading / Weakening / Improving / Lagging).
- Momentum skip-one (12-1 months, excluding last month) is **non-negotiable** — including last month introduces reversal bias.
- `PHASE_DESC` map (sector rotation interpretation) is a business logic decision that should move to the backend.
- API: `quantStrategiesApi.scan()` → POST `/api/quant/scan`

### `/short` — ShortPage (~1,045 lines)
- **Loads on mount**, no scan gate. Two-column CSS Grid: `3fr` (ShortCandidates) / `2fr` (SqueezeWatch).
- **Weak market boost**: `regime < 40` amplifies short edge score by up to 2.4× total via `regime_factor` + `weak_boost` terms.
- Grade table is identical to DeliveryPage but defined separately — should be centralized in `src/utils/grading.ts`.
- Decorative SVG components: `SquiggleUnderline`, `ResearchNote` — intentional editorial flourish, keep them.
- API: `shortApi.getScan()` → GET `/api/short/scan`

### `/stock-health` — StockHealthPage
- **Two views**: Stock Detail (20-metric behavioral profile for a single symbol) + Archetype Scanner (all 500 NSE stocks classified into 7 archetypes).
- **7 archetypes**: Elite Compounder · Steady Grinder · Lucky Speculator · Anti-Fragile Growth · Volatile Performer · Capital Trap · Mean Reverter.
- **3 composite scores**: Conviction (0–100), SWAN (0–100), Compounding Quality (0–100) — weighted sums of normalised sub-metrics. Frontend `ScoreBreakdown` mirrors backend `_norm()` weights exactly for formula display.
- **Scanner is instant** — backend serves from `data_lake/derived/stock_health/scan.parquet` on startup (<3s). First-ever run triggers batch warmup (~35s) and saves parquet; subsequent restarts load parquet.
- **Hero pattern**: matches IndicatorsPage/ShortPage — pulsing CYAN eyebrow badge → big JAKARTA headline ("Stock **Health**") → description → symbol selector inline in hero body → archetype chip row → score rings.
- **MetricRow collapsible**: two-level expand. Level 1 (click row): reveals "What this means" insight panel (amber border) + "How it's calculated" panel (CYAN border) with `what` text + `▶ Formula` sub-toggle + bands. Level 2 (click "▶ Formula"): reveals monospace formula box via `useState(false)` scoped inside MetricRow.
- **ScoreBreakdown formula toggle**: `▶ Formula` row per score card; open state tracked via `useState<Record<string, boolean>>({})` in `ScoreBreakdown` — allows independent toggles across all three cards rendered in a `.map()` without sub-components.
- **Polling pattern**: `getScan()` polls every 3s while `ready=false`; stops when `ready=true`. Instant when parquet is fresh.
- Force refresh after ingest: `POST /api/stock-health/scan/invalidate` → deletes parquet → triggers background recompute.
- API: `stockHealthApi.getScan()` → GET `/api/stock-health/scan`; `stockHealthApi.getReport(symbol)` → GET `/api/stock-health/{symbol}`

### `/stock/:symbol` — StockPage (~461 lines shell + sub-components)
- **URL param** `:symbol` — pages are linkable to specific stocks.
- **19+ sections**, sticky 2-row nav (Row 1: symbol/price/regime/selector; Row 2: jump strip with CYAN active underline).
- **18+ parallel API calls** on symbol change. DTW (section 14, Historical Analog) is O(n²) — must be pre-cached, never compute on-request.
- AI Research Assistant (section 8) streams from LLM — cancel via `AbortController` on symbol change.
- `Section` wrapper pattern: 2px gradient top border + monospace section number (`01`, `02`, …) + PAPER2 header.
- API: 18+ endpoints covering regime, DNA, RS, drawdown, returns, VaR, percentiles, AI assistant, what-changed, market structure, trend persistence, opportunity, insights, DTW analog, Z-score, dual momentum, statistical signals, vol lab, clusters, patterns, dynamics.

## Page → Doc file map

| Route | Doc file |
|-------|---------|
| `/` | `page_docu/landing_page.md` |
| `/agents` | `page_docu/agents_page.md` |
| `/cointegration` | `page_docu/cointegration_page.md` |
| `/dataviz` | `page_docu/dataviz_page.md` |
| `/delivery` | `page_docu/delivery_page.md` |
| `/fno-tactical` | `page_docu/fno_tactical_page.md` |
| `/indicators` | `page_docu/indicators_page.md` |
| `/markov-options` | `page_docu/markov_options_page.md` |
| `/pattern-dna` | `page_docu/pattern_dna_page.md` |
| `/pattern-dna-guide` | `page_docu/pattern_dna_guide_page.md` |
| `/quant-strategies` | `page_docu/quant_strategies_page.md` |
| `/short` | `page_docu/short_page.md` |
| `/stock` | `page_docu/stock_page.md` |
| `/stock-health` | `page_docu/stock_health_page.md` |

---

# Golden Rule

If a metric cannot survive rigorous validation, it does not belong in MarketDNA.

Research over opinions.
Evidence over narratives.
Features over indicators.
Validation over intuition.
