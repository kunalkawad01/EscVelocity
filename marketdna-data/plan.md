# Feature Engine — Implementation Plan

## Context: What Exists vs What's Needed

The backend currently computes everything **on demand, per request, from raw OHLCV**.
`regime_service.py` runs NumPy over 1601 bars per request — cold response is 10–20 seconds.
`stock_metrics.py` runs DuckDB per-symbol queries on each API call. Nothing is pre-computed.
`markov_options_service.get_market()` runs 500 serial DuckDB queries + NumPy on every page load.

With 500 symbols, on-demand computation doesn't scale. The feature engine pre-computes the
full history into `data_lake/features/` — the backend shifts to reading pre-built parquet
instead of doing analytics on the fly.

---

## Module Location

Lives entirely in `marketdna-data/` alongside ingestion — it reads raw OHLCV, writes to
`data_lake/features/`. The backend reads features via DuckDB views (same pattern as
`equities_prices`).

```
marketdna-data/
  feature_engine/
    __init__.py
    compute_all.py              <- orchestrator; entry point
    features/
      sma_regime.py             <- SMAs + Regime Score
      relative_strength.py      <- cross-sectional RS rank
      drawdown_recovery.py      <- drawdown + Recovery Score
      breadth.py                <- Market Breadth (NSE 500)
      returns_vol.py            <- multi-horizon returns + realized vol + ATR
      technical_indicators.py   <- RSI, MACD, BB, Stochastic, ADX, OBV, volume
      zscore.py                 <- 252d Z-Score + absolute momentum
      markov_regimes.py         <- monthly regime classification (6-regime Markov)
      markov_forecast.py        <- per-symbol next-state forecast + strategy
      stock_dna.py              <- Stock DNA composite
      market_dna.py             <- Market DNA composite
    writers/
      feature_writer.py         <- atomic parquet write with dedup/merge
    validators/
      post_compute.py           <- sanity checks on each output
```

---

## Output: Feature Store Layout

```
data_lake/features/
  sma_regime.parquet            <- 500 syms x ~1601 days = ~800K rows
  relative_strength.parquet     <- 500 syms x ~1580 days = ~790K rows
  drawdown_recovery.parquet     <- 500 syms x ~1601 days = ~800K rows
  breadth.parquet               <- ~1601 rows (market-level)
  returns_vol.parquet           <- 500 syms x ~1580 days = ~790K rows
  technical_indicators.parquet  <- 500 syms x ~1580 days = ~790K rows
  zscore.parquet                <- 500 syms x ~1348 days = ~674K rows
  markov_regimes.parquet        <- 500 syms x ~76 months = ~38K rows
  markov_forecast.parquet       <- 500 rows (one per symbol, current snapshot)
  stock_dna.parquet             <- 500 syms x ~1580 days = ~790K rows
  market_dna.parquet            <- ~1580 rows (market-level)
```

Flat parquets (not hive-partitioned) for features. DuckDB pushdown handles
`WHERE symbol = 'X'` on 800K rows in milliseconds. Cross-sectional queries also
work naturally.

---

## Build Sequence (strict dependency order)

```
Tier 1 — no dependencies (run in parallel):
  sma_regime
  drawdown_recovery
  relative_strength
  returns_vol
  technical_indicators
  zscore

Tier 2 — depend on Tier 1 (run in parallel after Tier 1):
  breadth           <- depends on sma_regime
  markov_regimes    <- depends on sma_regime + technical_indicators + returns_vol
  stock_dna         <- depends on sma_regime + drawdown_recovery + relative_strength + returns_vol

Tier 3 — depend on Tier 2 (run in parallel after Tier 2):
  markov_forecast   <- depends on markov_regimes
  market_dna        <- depends on breadth + stock_dna

Tier 4:
  register_views    <- update warehouse/register_views.py + duckdb_client.py
```

---

## Feature Definitions

### Tier 1 — `sma_regime.parquet`

**Columns:**
`symbol, date, close, sma20, sma50, sma100, sma200, price_score, alignment_score, slope_score, regime_score, regime_label`

**Formula:** Exact formula from `regime_service.py` — no change. Ported from per-request
NumPy to a bulk DuckDB window-function query across all 500 symbols in a single pass.

```sql
WITH sma_calc AS (
  SELECT symbol, date, close,
    AVG(close) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 19  PRECEDING AND CURRENT ROW) AS sma20,
    AVG(close) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 49  PRECEDING AND CURRENT ROW) AS sma50,
    AVG(close) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 99  PRECEDING AND CURRENT ROW) AS sma100,
    AVG(close) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) AS sma200
  FROM equities_prices
)
-- price_score, alignment_score, slope_score computed in Polars post-query
```

Slope (SMA[t] > SMA[t-k]) uses LAG() window functions in DuckDB directly.
Full computation is one query + minimal Polars post-processing.

**Lookbacks (from regime_service.py):**
- SMA20 slope: 5 bars
- SMA50 slope: 10 bars
- SMA200 slope: 20 bars

**Score components (0-100):**
- Price position: 4 x 10pt conditions = max 40
- SMA alignment (bull stack): 3 x 10pt conditions = max 30
- SMA slope (all rising): 3 x 10pt conditions = max 30

**Labels:** 80-100 Strong Bull | 60-79 Moderate Bull | 40-59 Neutral | 20-39 Moderate Bear | 0-19 Strong Bear

**Performance:** ~10s cold for all 500 x 1601 = 800K rows.

---

### Tier 1 — `drawdown_recovery.parquet`

**Columns:**
`symbol, date, close, rolling_peak_2y, drawdown_pct, recovery_score`

**Drawdown formula:**
```
rolling_peak_2y = MAX(close) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 503 PRECEDING AND CURRENT ROW)
drawdown_pct    = (close - rolling_peak_2y) / rolling_peak_2y * 100   -- always <= 0
```

**Recovery Score (0-100):**
```
recovery_score = GREATEST(0, 100 + drawdown_pct * 2)
```

| Drawdown | Recovery Score |
|----------|----------------|
| 0% (at ATH) | 100 |
| -25% | 50 |
| -50% | 0 (floor) |
| < -50% | 0 (capped) |

Rationale: simple, linear, explainable. -50% anchors the floor as the maximum
expected drawdown for large-cap Indian equities. Formula is deliberately minimal
pending Phase 3 validation.

**Performance:** Single DuckDB window query, ~5s.

---

### Tier 1 — `relative_strength.parquet`

**Columns:**
`symbol, date, return_20d, rs_rank, rs_total_symbols, rs_score`

**Formula:**
```
return_20d = (close - LAG(close, 20) OVER (PARTITION BY symbol ORDER BY date))
             / LAG(close, 20) OVER (PARTITION BY symbol ORDER BY date) * 100

rs_rank    = RANK() OVER (PARTITION BY date ORDER BY return_20d DESC)

rs_score   = (1 - (rs_rank - 1) / NULLIF(rs_total_symbols - 1, 0)) * 100
             -- 100 = top performer, 0 = bottom
```

Ranks across **all symbols with data on that date** — ranges from ~384 in Jan 2020
to 500 in Jun 2026. Both `rs_rank` (absolute) and `rs_score` (0-100 percentile) are
stored so the backend can display either.

Note: existing `stock_metrics.py` computes this per-symbol on demand.
Feature store makes it instant.

**Performance:** Single DuckDB query with two window functions, ~5s.

---

### Tier 1 — `returns_vol.parquet`

**Columns:**
`symbol, date, return_1d, return_5d, return_20d, return_63d, return_252d, vol_21d, atr_14, atr_pct`

**Formulas:**
```
return_Nd  = (close - LAG(close, N) OVER (...)) / LAG(close, N) OVER (...) * 100
vol_21d    = STDDEV(return_1d) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 20 PRECEDING AND CURRENT ROW)
             * SQRT(252) * 100        -- annualised %
atr_14     = Wilder 14-period smoothing of True Range (computed in Polars post-query)
atr_pct    = atr_14 / close * 100
```

True Range needs high/low — query raw OHLCV (include high, low in the pull).

**Why this parquet:**
- `return_20d` already exists in `relative_strength.parquet` — stored here too for joins
- `return_63d`, `return_252d` enable Dual Momentum (`get_statistical_signals()`) without reading OHLCV
- `vol_21d` is used in Stock DNA efficiency score and CVaR — stored independently for direct query
- `atr_14` / `atr_pct` is the 5th feature vector element in the Analog engine (`get_analogs()`)
- Multi-horizon return surface enables Phase 6 portfolio construction (Fama-French momentum sort)

**Performance:** ~8s cold (needs high/low; slightly heavier query).

---

### Tier 1 — `technical_indicators.parquet`

**Columns:**
```
symbol, date,
rsi_14,
ema_20, ema_50,
macd_line, macd_signal, macd_hist,
bb_upper, bb_lower, bb_pct_b, bb_bandwidth,
stoch_k, stoch_d,
atr_14, atr_pct,
adx_14, plus_di_14, minus_di_14,
volume_sma20, volume_ratio,
obv
```

**Formulas (standard parameters):**

| Indicator | Formula |
|-----------|---------|
| RSI(14) | Wilder smoothed gains/losses ratio |
| EMA(20), EMA(50) | Exponential moving average |
| MACD(12,26,9) | EMA12 − EMA26; signal = EMA9(MACD); hist = MACD − signal |
| Bollinger(20,2) | SMA20 ± 2σ; %B = (close − lower)/(upper − lower); bandwidth = (upper−lower)/SMA20 |
| Stochastic(14,3,3) | %K = (close − 14d low)/(14d high − 14d low); %D = SMA3(%K) |
| ATR(14) | Wilder smoothed True Range |
| ADX(14) | Wilder smoothed DX; +DI = 100×Wilder(+DM)/ATR; −DI = 100×Wilder(−DM)/ATR |
| Volume SMA(20) | 20-day simple moving average of volume |
| Volume ratio | volume / volume_sma20 |
| OBV | Cumulative volume signed by daily return direction |

**ADX note:** `adx_14` is trend strength 0–100 (>25 = trending, direction-neutral).
`plus_di_14` / `minus_di_14` capture directional pressure. All three columns are
stored — `adx_14` alone discards the +DI/−DI crossover signal used by the Edge Lab.

**bb_bandwidth note:** Free to compute alongside `bb_pct_b`; it is the canonical
volatility-compression signal (squeeze setups — low bandwidth preceding breakout).

**History depth:** Full 6-year history (not just 500 bars). Edge Lab requires
historical signal occurrences going back to 2020.

**Why this parquet:**
- Indicators scanner currently covers only 48 NIFTY50 symbols; pre-computing enables
  instant 500-symbol scan
- Markov regime classifier (`markov_options_service.py`) recomputes ADX, RSI, HV20
  from scratch per symbol — `markov_regimes.parquet` can read these values directly
- Edge Lab (`indicator_edge_service.py`) recomputes all indicators per-symbol per-analysis

**Performance:** ~15s cold (Wilder smoothing done in Polars, vectorised per symbol).

---

### Tier 1 — `zscore.parquet`

**Columns:**
`symbol, date, zscore_252d, abs_mom_252d`

**Formulas:**
```
mean_252d  = AVG(close) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 251 PRECEDING AND CURRENT ROW)
std_252d   = STDDEV(close) OVER (...)
zscore_252d = (close - mean_252d) / NULLIF(std_252d, 0)

abs_mom_252d = return_252d            -- read from returns_vol.parquet (join on symbol, date)
```

**Why this parquet:**
- `get_statistical_signals()` in `stock_metrics_advanced.py` computes 252d rolling
  Z-Score per-symbol on every request — expensive for 500 symbols
- `abs_mom_252d` co-located here enables Dual Momentum computation in one join

**Warmup:** Requires 252 daily bars before first valid row (~1349 valid rows per symbol).

**Performance:** Single DuckDB window query, ~6s cold.

---

### Tier 1 — `breadth.parquet`

**Columns:**
`date, n_symbols, above_sma20, above_sma50, above_sma200, pct_above_sma20, pct_above_sma50, pct_above_sma200, breadth_score, breadth_label, nifty50_breadth_score`

**Formula (from regime_service.py, expanded to NSE 500):**
```
breadth_score = pct_above_sma20 * 0.30
              + pct_above_sma50 * 0.40
              + pct_above_sma200 * 0.30
```

Reads SMA values from `sma_regime.parquet` (no re-computation).

Also stores `nifty50_breadth_score` using the 48-stock NIFTY50 subset to preserve
backward compatibility with existing API responses.

**Labels:** >=70 Broad Participation | 50-69 Moderate Breadth | 30-49 Narrow Breadth | <30 Poor Breadth

**Performance:** Aggregation over sma_regime parquet, ~2s.

---

### Tier 2 — `markov_regimes.parquet`

**Columns:**
`symbol, month, close, adx_14, rsi_14, sma50, pct_vs_sma50, monthly_ret, hv20, hv_ratio, regime`

One row per (symbol × calendar month) — last trading day of each month.

**Regime classification (from `markov_options_service._classify()`):**

| Inputs | Threshold |
|--------|-----------|
| Bull signals | RSI≥55, price>SMA50+1.5%, monthly_ret>1% — need 2-of-3 |
| Bear signals | RSI≤45, price<SMA50−1.5%, monthly_ret<−1% — need 2-of-3 |
| High vol | hv_ratio ≥ 1.20 (hv20 > 1.20 × median_hv over all months for that symbol) |

**6 regimes:** Strong Uptrend | Volatile Bull | Sideways Quiet | Sideways Volatile | Steady Bear | Volatile Bear

**`hv_ratio` computation:**
```
hv20       = 20-day annualised log-return volatility on the last trading day of each month
             (= vol_21d from returns_vol.parquet, read at month-end dates)
median_hv  = median(hv20) across ALL months for that symbol
hv_ratio   = hv20 / median_hv
```

`median_hv` is a per-symbol global — means the full monthly history must be present before
classifying. This is NOT an append-only feature: when a new month completes, `median_hv`
can shift and reclassify prior months. **Recompute all rows monthly, not incrementally.**

**Source of daily indicator values:**
- `adx_14`, `rsi_14` → read from `technical_indicators.parquet` at month-end dates
- `sma50` → read from `sma_regime.parquet` at month-end dates
- `hv20` (vol_21d) → read from `returns_vol.parquet` at month-end dates
- `close` → read from `sma_regime.parquet` at month-end dates

This avoids recomputing ADX/RSI from scratch (matching exact Wilder smoothing in the service).

**Why this parquet:**
- Markov matrix is built from this table — building it from 38K rows is instant
  vs fetching 2000 daily bars per symbol from OHLCV
- `get_market()` currently runs 500 symbol computations serially; this eliminates
  the per-symbol OHLCV fetch + indicator computation entirely

**Performance:** ~3s (join across three Tier 1 parquets, filter to month-end dates, compute hv_ratio).

---

### Tier 3 — `markov_forecast.parquet`

**Columns:**
`symbol, date, current_regime, prob_strong_uptrend, prob_volatile_bull, prob_sideways_quiet, prob_sideways_volatile, prob_steady_bear, prob_volatile_bear, dominant_regime, dominant_prob, tail_risk_regime, tail_risk_prob, primary_strategy, iv_action`

One row per symbol (500 rows). Updated daily.

**Computation:**
```
1. For each symbol, read its monthly regime history from markov_regimes.parquet
2. Build 6×6 transition count matrix
3. Blend with NSE prior: blended = (1 − 0.20) × observed + 0.20 × prior
   prior = [0.20, 0.08, 0.25, 0.10, 0.25, 0.12]  (NSE long-run base rates)
4. current_regime = regime in the most recent month row
5. next_probs = one_hot(current_regime) @ blended_matrix
6. dominant_regime = argmax(next_probs)
7. tail_risk_regime = second highest if prob >= 0.15, else null
8. primary_strategy, iv_action from static _STRATEGY_MAP lookup
```

Blending logic and _STRATEGY_MAP are copied exactly from `markov_options_service.py`.

**Why this parquet:**
- `get_market()` reads this as a single 500-row scan — instantly returns the full
  market regime view vs O(500) DuckDB queries today
- `get_symbol()` reads this for forecast + strategy; reads `markov_regimes` for history
  and matrix — eliminates per-symbol OHLCV download on the hot path

**Performance:** ~2s for all 500 symbols (pure Python matrix ops, no DuckDB needed after markov_regimes is ready).

---

### Tier 2 — `stock_dna.parquet`

**Columns:**
`symbol, date, regime_score, recovery_score, drawdown_pct, rs_score, efficiency_score, stock_dna_score, stock_dna_label`

**Efficiency Score (proposed, pending validation):**
```
return_21d       = return_20d from returns_vol.parquet
vol_21d          = vol_21d from returns_vol.parquet
raw_efficiency   = return_21d / max(vol_21d, 0.01)   -- Sharpe-like ratio
efficiency_score = GREATEST(0, LEAST(100, 50 + raw_efficiency * 10))
```
Centred at 50 (neutral). `vol_21d` is read from `returns_vol.parquet` — no recomputation.

**Stock DNA Score (composite, 0-100):**
```
stock_dna_score = regime_score    * 0.35
               + rs_score         * 0.25
               + recovery_score   * 0.20
               + drawdown_score   * 0.10   -- same as recovery_score formula applied to drawdown_pct
               + efficiency_score * 0.10
```

| Component | Weight | Rationale |
|-----------|--------|-----------|
| Regime | 35% | Primary structural quality signal |
| Relative Strength | 25% | Peer comparison is a core edge signal |
| Recovery | 20% | Resilience under stress |
| Drawdown | 10% | Current stress context |
| Efficiency | 10% | Risk-adjusted momentum |

**Labels:** 80-100 Tier 1 | 60-79 Tier 2 | 40-59 Tier 3 | <40 Avoid

**Performance:** Polars join of sma_regime + drawdown_recovery + relative_strength + returns_vol, ~3s.

---

### Tier 3 — `market_dna.parquet`

**Columns:**
`date, breadth_score, avg_regime_score, stress_score, leadership_score, market_dna_score, market_dna_label`

**Component definitions:**

| Component | Formula | Weight |
|-----------|---------|--------|
| Breadth | Pre-computed from `breadth.parquet` | 30% |
| Avg Regime | Mean of all 500 stocks' regime scores on that day | 30% |
| Leadership | % of stocks with rs_score > 60 AND regime_score > 60 | 25% |
| Stress | `GREATEST(0, 100 + mean(drawdown_pct) * 2)` — same anchor as recovery | 15% |

```
market_dna_score = breadth_score    * 0.30
                 + avg_regime_score * 0.30
                 + leadership_score * 0.25
                 + stress_score     * 0.15
```

**Labels:** >=70 Expansion | 50-69 Recovery | 30-49 Contraction | <30 Recession

**Performance:** Aggregations over stock_dna and breadth parquets, ~2s.

---

## DuckDB View Registration

Update `warehouse/register_views.py` (data-side) and backend's
`app/services/duckdb_client.py` to register:

```python
CREATE VIEW regime_features        AS SELECT * FROM read_parquet('data_lake/features/sma_regime.parquet')
CREATE VIEW rs_features            AS SELECT * FROM read_parquet('data_lake/features/relative_strength.parquet')
CREATE VIEW drawdown_features      AS SELECT * FROM read_parquet('data_lake/features/drawdown_recovery.parquet')
CREATE VIEW breadth_features       AS SELECT * FROM read_parquet('data_lake/features/breadth.parquet')
CREATE VIEW returns_vol_features   AS SELECT * FROM read_parquet('data_lake/features/returns_vol.parquet')
CREATE VIEW indicators_features    AS SELECT * FROM read_parquet('data_lake/features/technical_indicators.parquet')
CREATE VIEW zscore_features        AS SELECT * FROM read_parquet('data_lake/features/zscore.parquet')
CREATE VIEW markov_regimes         AS SELECT * FROM read_parquet('data_lake/features/markov_regimes.parquet')
CREATE VIEW markov_forecast        AS SELECT * FROM read_parquet('data_lake/features/markov_forecast.parquet')
CREATE VIEW stock_dna              AS SELECT * FROM read_parquet('data_lake/features/stock_dna.parquet')
CREATE VIEW market_dna             AS SELECT * FROM read_parquet('data_lake/features/market_dna.parquet')
```

Both `register_views.py` (data module) and `duckdb_client.py` (backend) must register
these views so both sides can query them.

---

## Incremental Mode

**Daily features** (sma_regime, drawdown_recovery, relative_strength, returns_vol,
technical_indicators, zscore, markov_forecast):
- Read existing parquet, find `max(date)`
- Query only `WHERE date > max_date` from raw OHLCV
- For window-function features (sma_regime, RS, drawdown, indicators), read the last 250
  raw bars per symbol as warm-up context before the incremental window
- Append new rows, dedup on `(symbol, date)`, write back

**Monthly features** (markov_regimes):
- **Recompute fully every month** — `hv_ratio` depends on `median_hv` across all months,
  so partial appends produce wrong classifications
- On non-month-end days: rebuild only the current-month rows (incomplete month, daily update)
- On month-end: full recompute for that symbol to refresh `median_hv` and reclassify all rows

Run daily after ingestion completes:
```powershell
.venv\Scripts\python.exe -m feature_engine.compute_all --incremental
```

---

## Validation (post-compute, per feature)

| Check | sma_regime | drawdown | RS | returns_vol | indicators | zscore | markov_reg | markov_fc | breadth | stock_dna | market_dna |
|-------|-----------|----------|----|------------|------------|--------|-----------|---------|---------|-----------|------------|
| No nulls in score columns | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Score range 0-100 | Y | Y | Y | — | Y (RSI) | — | — | Y (probs) | Y | Y | Y |
| No duplicate (symbol, date/month) | Y | Y | Y | Y | Y | Y | Y | — | — | Y | — |
| Row count >= OHLCV rows - warmup | Y | Y | — | — | — | — | — | — | Y | — | — |
| Labels from valid set | Y | — | — | — | — | — | Y | Y | Y | Y | Y |
| Prob rows sum to 1.0 ± 0.001 | — | — | — | — | — | — | — | Y | — | — | — |

Validation failures log warnings but do not abort — partial features are better than
no features. A validation report is printed at the end of each run.

---

## Performance Estimates

| Step | Tier | Mode | Estimated time |
|------|------|------|---------------|
| sma_regime (800K rows) | 1 | Cold | ~10s |
| drawdown_recovery | 1 | Cold | ~5s |
| relative_strength | 1 | Cold | ~5s |
| returns_vol | 1 | Cold | ~8s |
| technical_indicators | 1 | Cold | ~15s |
| zscore | 1 | Cold | ~6s |
| breadth | 2 | Cold | ~2s |
| markov_regimes (38K rows) | 2 | Cold | ~3s |
| stock_dna | 2 | Cold | ~3s |
| markov_forecast (500 rows) | 3 | Cold | ~2s |
| market_dna | 3 | Cold | ~1s |
| **Total first run (parallel tiers)** | | | **~35s** |
| Daily incremental (500 new rows per daily feature) | | Warm | ~8-12s |

---

## What Changes in the Backend

After the feature engine runs, these services are updated to read from views:

| Service | Current behaviour | After feature engine |
|---------|------------------|----------------------|
| `regime_service.get_regime_score()` | Raw OHLCV + NumPy per request, 10-20s cold | Reads `regime_features` view — instant |
| `regime_service.get_breadth_score()` | Window functions over NIFTY50 per request | Reads `breadth_features` view — instant |
| `regime_service.get_market_snapshot()` | 50 serial per-symbol queries | Single query on `regime_features` |
| `stock_metrics.get_relative_strength()` | Cross-sectional DuckDB per request | Reads `rs_features` view — instant |
| `stock_metrics_advanced.get_statistical_signals()` | Raw OHLCV + rolling NumPy | Reads `zscore_features` + `returns_vol_features` — instant |
| `indicators_service.get_market_scan()` | 48 symbols, computes all indicators per request | Reads `indicators_features` — any N symbols, instant |
| `markov_options_service.get_symbol()` | Fetches 2000 OHLCV bars + NumPy per symbol | Reads `markov_forecast` + `markov_regimes` — instant |
| `markov_options_service.get_market()` | 500 serial DuckDB queries + NumPy | Single 500-row scan on `markov_forecast` — instant |
| Stock DNA, Market DNA | Not exposed yet | New endpoints, reads from views |

Existing API contracts (response shapes, routes) do not change. Only the data source
inside each service function changes.

---

## What Is NOT in This Plan

- **Options IV surface** — Phase 7, no options chain data yet
- **GARCH(1,1)** — MLE per-symbol is slow; keep on-demand with module-level cache
- **HMM / GMM regime clusters** — slow model fitting; validated in Phase 3 first
- **Pattern DNA / DTW** — parameterized by query (user picks the pattern window)
- **K-Means clusters** — session-level analysis, not a daily feature
- **Indicator Edge Lab forward returns** — user selects indicator + threshold; output
  is per-analysis, not a daily snapshot
- **Rolling Beta** — pairwise computation (stock vs equal-weight index); expensive for 500
  symbols; keep on-demand with caching
- **Validation framework (forward returns, decile analysis)** — Phase 3
- **Delivery % features** — data coverage is NIFTY50 only from 2025; not broad enough
  for a 500-symbol feature store yet

---

## Run Command

```powershell
# From marketdna-data/ with venv active

# Full history (first run)
.venv\Scripts\python.exe -m feature_engine.compute_all

# Incremental (daily, run after ingestion)
.venv\Scripts\python.exe -m feature_engine.compute_all --incremental

# Single feature only
.venv\Scripts\python.exe -m feature_engine.compute_all --only sma_regime
.venv\Scripts\python.exe -m feature_engine.compute_all --only technical_indicators
.venv\Scripts\python.exe -m feature_engine.compute_all --only markov_regimes
.venv\Scripts\python.exe -m feature_engine.compute_all --only markov_forecast
.venv\Scripts\python.exe -m feature_engine.compute_all --only stock_dna
```
