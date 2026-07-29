# StockEDAPage — `/stock-eda/:symbol`

## 1. What It Is Doing

Chart-first exploratory data analysis for a single symbol — the visualization counterpart to
StockPage. Where StockPage's 19 sections are almost entirely **model outputs** (regime score,
DNA, VaR, DTW analogs, Markov clusters), Stock EDA shows **raw distributions and structure**
with no scores or verdicts: return histograms, seasonality, volatility clustering, gaps, volume
profile, autocorrelation, extreme days, and a benchmark comparison bar chart. The goal is to let
a trader build their own view from the data rather than read a pre-computed conclusion.

Route: `/stock-eda/:symbol`. Same sticky 2-row nav + section-jump-strip + `Section` wrapper
pattern as StockPage (2px gradient top border, mono `0N` section numbering, one accent color
per section).

**10 sections**:
| # | Section | Accent | Data source |
|---|---------|--------|-------------|
| 1 | Price & Volume — candlestick + volume panes | Blue | `stockApi.getOHLCV` (existing) |
| 2 | Return Distribution — daily/monthly histogram + stats | Green | `stockApi.getReturns` (existing) |
| 3 | Volatility Clustering — rolling 20d realized vol + vol-of-vol | Amber | `stockEdaApi.getVolatilitySeries` (new) |
| 4 | Drawdown — underwater curve + worst-10 episodes table | Red | `stockApi.getDrawdown` (existing chart) + `stockEdaApi.getDrawdownHistory` (new table) |
| 5 | Seasonality — day-of-week × month heatmap + yearly bars | Violet | `stockEdaApi.getSeasonality` (new) + `returns.yearly_returns` (existing) |
| 6 | Gap Analysis — gap-size buckets vs fill rate | Teal | `stockEdaApi.getGaps` (new) |
| 7 | Volume Profile — volume-at-price histogram + point of control | Blue | `stockEdaApi.getVolumeProfile` (new) |
| 8 | Autocorrelation — ACF lags 1–20 + significance band | Amber | `stockEdaApi.getAutocorrelation` (new) |
| 9 | Extreme Days — best/worst 15 single-day moves | Red | `stockEdaApi.getExtremeDays` (new) |
| 10 | Benchmark Comparison — last 5 days: stock vs sector vs Nifty 50/200/500 | Green | `stockEdaApi.getBenchmarkComparison` (new) |

Sections 1, 2, and the drawdown chart in section 4 deliberately reuse existing `/api/stock/*`
endpoints instead of duplicating them — `ReturnsResponse` already ships daily/monthly/yearly
histograms and stats, and `DrawdownResponse`/`DrawdownSection.tsx` already render the underwater
curve. Only the genuinely new EDA views (volatility clustering, seasonality, gaps, volume
profile, ACF, extreme days, benchmark comparison) got new backend endpoints.

All 12 API calls (2 reused stock endpoints + `getSummary` for the hero + 1 reused drawdown +
8 new EDA endpoints) fire in parallel on symbol change via the same `load()` helper pattern as
StockPage.

---

## 2. Optimization

- Every new endpoint does exactly one bulk DuckDB fetch per symbol (`_fetch_ohlcv_arrays`), then
  computes in NumPy/Polars — no per-row round-trips.
- All new service functions are `@_day_cached` (local decorator, mirrors `stock_metrics._day_cached`)
  — first call per symbol per day is the only one that hits DuckDB.
- Benchmark Comparison is the heaviest new endpoint: it bulk-fetches ~500 symbols' closes for the
  last 21 calendar days in one `WHERE symbol IN (...)` query, then averages in Python — never
  per-symbol queries. Reuses `sector_heatmap_service`'s existing `_N50`/`_N200_ADDS`/`_N500_ADDS`
  taxonomy via three new small public helpers (`get_symbol_sector`, `get_universe_symbols`,
  `get_sector_symbols`) rather than duplicating the sector maps.
- No global lookback/timeframe control in v1 — each endpoint uses a sensible default (full
  history for most, last 252 bars for Volume Profile, last 5 years reused from the existing
  drawdown endpoint). A page-wide lookback selector is a natural fast-follow (see Suggestions).

---

## 3. Lessons Learnt

- **Check for reusable data before building a new endpoint.** `ReturnsResponse` already had
  daily/monthly/yearly histograms, stats, and yearly returns — building a separate "return
  distribution" endpoint would have duplicated existing, validated backend logic. Always check
  `app/models/stock.py` + `stock_metrics.py` before adding a new stat endpoint.
- **"One axis" chart rule applies to vol-of-vol.** Realized vol (~15–40%) and vol-of-vol (~1–5%)
  are on very different scales; rather than a dual-axis overlay (against the dataviz skill's
  non-negotiable rule), they're rendered as two small-multiple charts stacked vertically.
- **Seasonality heatmap is hand-rolled CSS grid, not a Highcharts heatmap module.** Avoids pulling
  in `highcharts/modules/heatmap` for a 5×12 grid — a `display:grid` of colored `Box` cells with
  a `title` tooltip is simpler and matches the codebase's existing pattern of hand-rolled inline
  SVG/CSS widgets (e.g. `ScoreRing` in StockHealthPage).
- **Benchmark Comparison assigns color by entity identity, not by win/loss sign** — Stock/Sector/
  Nifty 50/200/500 each get a fixed categorical color (CYAN/violet/blue/teal/amber) rather than
  green/red, since this chart compares five different things, not one thing's direction.

---

## 4. Business Logic

**Volatility Clustering**: `realized_vol_20d = rolling_std(daily_returns, 20) * sqrt(252)`
(annualised %). `vol_of_vol_20d = rolling_std(realized_vol_20d, 20)` — measures how unstable
volatility itself is. `vol_percentile` = current value's percentile rank within its own history.

**Drawdown History**: same underwater-curve algorithm as `stock_metrics.get_drawdown`, but instead
of returning the full series it detects discrete drawdown episodes (peak → trough → recovery),
sorts by depth, and returns the worst 10. `recovery_date` is `null` if the drawdown hasn't
recovered yet (as of the last available bar).

**Seasonality**: for each (month, day-of-week) pair, average daily return % and sample count `n`.
`best_month`/`worst_month` computed from the month-level average across all weekdays.

**Gap Analysis**: `gap_pct = (open[t] - close[t-1]) / close[t-1] * 100`. A gap is "filled" if the
day's range retraces back through the prior close (`low <= prev_close` for gap-ups, `high >=
prev_close` for gap-downs). Bucketed by `|gap_pct|` into 0-1% / 1-2% / 2-3% / >3%.

**Volume Profile**: bins the price range (of the last `bars` window, default 252) into 24 equal
bins by typical price `(high+low+close)/3`, sums volume per bin. Point of Control = midpoint of
the highest-volume bin.

**Autocorrelation**: sample ACF of daily returns at lags 1–20 (manual NumPy computation, not
statsmodels — `cov(r[:-lag], r[lag:]) / var(r)`). 95% significance band = `1.96 / sqrt(n)`.

**Extreme Days**: top/bottom 15 single-day returns, each annotated with `volume_ratio = day's
volume / trailing 20d avg volume` (rolling mean via Polars).

**Benchmark Comparison**: for each of the last 5 trading days, computes the stock's own daily
return alongside three equal-weighted proxy returns — sector (via `sector_heatmap_service`'s
nifty500 sector taxonomy), Nifty 50, Nifty 200, and Nifty 500 (equal-weight average of each
universe layer's daily returns, matching the existing Sector Heatmap's Nifty-proxy convention).

---

## 5. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, Material UI, Highcharts/Highstock |
| Routing | React Router (`/stock-eda/:symbol`) |
| API | 4 reused `/api/stock/*` calls (symbols, summary, ohlcv, returns, drawdown) + 8 new `/api/stock-eda/*` calls |
| Backend | `app/routers/stock_eda.py` + `app/services/stock_eda_service.py` (pure NumPy/Polars, no FastAPI imports) + `app/models/stock_eda.py` |
| Charts | Highstock candlestick+volume (panes), column histograms, area (vol), line (vol-of-vol), bar (volume profile), grouped column (benchmark comparison), hand-rolled CSS grid (seasonality heatmap) |
| Caching | In-process `@_day_cached` per new service function (local copy of `stock_metrics._day_cached` pattern) |
| Design | `usePalette()`, `useTokens()`, shared `Section` wrapper + sticky jump nav (copied from StockPage) |

---

## 6. Suggestions to Achieve the Objective

1. **Global lookback/timeframe selector** (1Y/3Y/5Y/Max) in the hero that drives every section at
   once, rather than each endpoint's independent default window. Would need each new endpoint to
   accept a `years` or `bars` query param.
2. **Peer/sector correlation matrix** (deferred from v1): a rolling 60d correlation/beta line vs
   the Nifty proxy, plus a small correlation matrix against 5–8 sector peers — the section that
   was scoped out to ship the rest of the page faster.
3. **Skew/kurtosis on the Return Distribution card** — `ReturnStats` currently has mean/median/std/
   p5/p95/max/min but not skew or kurtosis; would need a small addition to `stock_metrics._return_stats`
   rather than a new endpoint here.
4. **Click-through from Extreme Days / Drawdown episodes to the Price & Volume chart**, scrolling
   and zooming section 1 to that date range — turns the tables into a navigation aid, not just a
   list.
5. **Export to CSV** for any table section (drawdown episodes, extreme days, gap buckets) — this
   page is meant for building an independent view, and raw data export supports that better than
   a "research brief" summary would.
