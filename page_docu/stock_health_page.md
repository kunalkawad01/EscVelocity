# StockHealthPage — `/stock-health`

## 1. What It Does

20-metric behavioural profile of a stock's return quality, plus an archetype scanner that classifies every stock in the NSE 500 universe.

**Two views** (toggle in hero):
- **Stock Detail** — deep-dive profile for one symbol
- **Archetype Scanner** — all 500 NSE stocks ranked inside 7 behavioural archetypes

---

### Stock Detail

**Identity strip** (hero): symbol selector + archetype chip + data span.

**Three composite score rings** (`ScoreRing` — SVG circle with animated arc):

| Score | Colour | What it measures |
|-------|--------|-----------------|
| Conviction | Blue `#3b82f6` | How trustworthy is the return pattern? |
| SWAN | Green `#22c55e` | Sleep-Well-At-Night — how comfortable is it to hold? |
| Compounding Quality | Purple `#a855f7` | Is the growth genuinely compounding? |

`ScoreBreakdown` shows each score's formula, per-component weights, raw values, `+X.X pts` contribution, and a progress bar. Frontend `norm()` mirrors backend `_norm()` exactly — the displayed numbers are real.

**DNA Radar** (`DnaRadar`) — Highcharts polar/line chart over 6 axes: Conviction, SWAN, Compounding, Capital Efficiency, Anti-Fragility, Consistency. Gives an at-a-glance shape of the stock's behavioural profile.

**MetricRow** (collapsible) — every metric row has a `▶` chevron that rotates to `▼` on click, revealing:
- Plain-English explanation (`what`)
- Real-number formula with live values (`formula`)
- Colour-coded interpretation band (`bands`: red dot = bad, amber = ok, green = good)
- CSS `@keyframes fadeSlide` animation on expand; cyan left border on open panel

**Sections in Stock Detail** (each wrapped in `SectionHead` + `Card`):
1. Core Returns — CAGR, Monthly Consistency, Return Concentration, Capital Efficiency
2. Composite Scores — ScoreBreakdown cards (Conviction, SWAN, Compounding Quality)
3. Resilience — Max Drawdown, Drawdown Frequency, Avg Recovery Days, Time Under Water
4. Trend Quality — Trend Efficiency, Wealth Smoothness R², Skill Ratio, CAGR Ex-Top-N
5. Behavioral — Pain-to-Gain, Anti-Fragility, Opportunity Cost, Momentum Persistence (3/5/7-day)
6. DNA Radar — polar chart of 6 axes
7. Drawdown History — Highcharts area chart of full drawdown series
8. Crash Resistance — `CrashBar` bars for Covid 2020, Correction 2022, Selloff 2024
9. Regime Performance — `RegimeBlock` cells: Bull (score ≥ 60), Bear (≤ 40), Sideways
10. Momentum Persistence — `MomentumBar` for 3/5/7-day consecutive-up-day follow-through
11. Alpha Half-Life — `AlphaCell` grid: avg forward return 1/3/6/12 months after a top-quartile month
12. Archetype Legend — all 7 archetypes with trigger criteria, investor advice, `← this stock` tag on active

---

### Archetype Scanner

**Gate**: explicit "Run Archetype Scan" button on first visit — prevents accidental polling on page load.

**Two-pane layout**:
- **Left sidebar** (240px fixed): 7 archetype rows, each with icon + name + live count badge. Active archetype has colour left-border + tinted background.
- **Right panel**: archetype header (investor advice + trigger criteria), then a stock table with columns SYMBOL / years data / CONV. / SWAN / CMPD. / CAGR / MAX DD. Sorted by Conviction descending.

**Polling**: `poll()` fires `getScan()` every 3 seconds while `ready=false`. Stops when `ready=true`. On typical startup (parquet fresh), first poll returns `ready=true` immediately — no visible loading.

**Progress bar**: shown while `!ready && computed > 0`. Hides when complete.

**Click-through**: clicking a stock row calls `onSelect(symbol)` → switches to Stock Detail view for that symbol.

---

## 2. Optimization

- **Parquet-first startup** — `GET /api/stock-health/scan` loads from `data_lake/derived/stock_health/scan.parquet` (13 KB, 478 symbols). First-ever run triggers batch warmup (~35s); subsequent restarts are instant (<3s). The frontend polling loop fires once and stops immediately when the parquet is fresh.
- **Batch DuckDB warmup** — 4 bulk queries replace 2,500 serial queries: 1 × OHLCV for all symbols + 3 × crash-period returns `GROUP BY symbol`. Monthly returns computed from daily closes in Python (`_monthly_returns()`) — no extra query. Result: ~35s for 500 symbols (was ~30 min, 50× speedup).
- **`_analytics()` is pure NumPy** — zero DuckDB I/O. Can be called from both single-symbol `_compute()` and the batch path without duplication.
- **`ScoreBreakdown` mirrors backend `_norm()` weights exactly** — no extra API call for score component data; all values derived from the already-fetched `StockHealthReport`.
- **`useMemo` for grouped archetype buckets** — `grouped = ARCHETYPES.reduce(...)` only recomputes when `items` changes, not on every archetype tab click.
- **Drawdown chart uses full series** — `drawdown_series` is every trading day (~1,500 points). Consider decimating to weekly points if chart render becomes slow.
- `HighchartsMore` is imported at module level (required for the polar radar chart). If StockHealthPage is lazy-loaded, this import stays on the main bundle — move the import inside `DnaRadar` if bundle size becomes a concern.

---

## 3. Lessons Learnt

- **MetricRow collapsible pattern is reusable** — the `▶ chevron → rotate 90° → CYAN border + PAPER2 bg` expand-in-place pattern works well for any metric table where the label is self-explanatory but the formula needs a drill-down. Extract to `src/components/shared/MetricRow.tsx` before copying to other pages.
- **`norm()` must match `_norm()` exactly** — any drift between frontend and backend normalisation ranges breaks `ScoreBreakdown`. When changing a composite score formula, always update both files together.
- **Parquet stale detection uses `computed_date` column** — the parquet stores one date string per row. `_load_scan_from_parquet()` checks if any row has `computed_date == today`. If no today rows exist, data is served immediately (stale) and a background recompute starts. This means day-1 data is instantly visible while fresh data builds.
- **Archetype classifier is a waterfall, not a score** — conditions are checked in priority order (Elite Compounder first, Mean Reverter last). A stock that meets the Anti-Fragility threshold but also meets Steady Grinder will be labelled Steady Grinder because that check comes earlier. This is intentional — avoid changing the order without re-validating all 500 classifications.
- **`ArchetypeSummary` is a flat snapshot** — it stores only the 7 fields needed for the scanner table. Full `StockHealthReport` (with `drawdown_series`, `crash_resistance`, `alpha_half_life`) is fetched on-demand by `getReport(symbol)`. Never try to reconstruct a full report from the summary.
- **Route conflict: `/scan` must be registered before `/{symbol}`** — FastAPI would otherwise match the literal string "scan" as a symbol name. Always put fixed-path routes before parameterised ones in the same router.

---

## 4. Business Logic

### 20 Metrics

| # | Metric | Formula | Good range |
|---|--------|---------|-----------|
| 1 | CAGR | `(last/first)^(1/years) - 1` | > 15% |
| 2 | Monthly Consistency | `% months with positive return` | > 60% |
| 3 | Return Concentration | `top-5-day return / total return` | < 40% |
| 4 | Capital Efficiency | `CAGR_frac / abs(max_dd_frac)` | > 0.5 |
| 5 | Max Drawdown | `min((price - running_max) / running_max)` | > -30% |
| 6 | Drawdown Frequency | count of drawdowns ≥ 10% | < 5 |
| 7 | Avg Recovery Days | avg trading days from trough back to prior peak | < 120d |
| 8 | Time Under Water | `% days price < running_max` | < 50% |
| 9 | Trend Efficiency | `net_price_change / sum_of_all_daily_moves` | > 0.15 |
| 10 | Wealth Smoothness R² | log-linear R² of price on time | > 0.85 |
| 11 | Skill Ratio | `CAGR_ex_top10 / CAGR` | > 0.7 |
| 12 | CAGR Ex-Top-N | CAGR after removing best 1/5/10 days | > 10% |
| 13 | Pain-to-Gain | `sum(abs(daily_dd)) / total_gain_pct` | < 1.5 |
| 14 | Anti-Fragility | `corr(rolling_63d_vol, fwd_return)` | > 0.1 |
| 15 | Opportunity Cost | `% years stock was within ±5% of year-ago price` | < 15% |
| 16 | Momentum Persistence | `P(next day up | N consecutive up days)`, N=3/5/7 | > 55% |
| 17 | Regime Performance | cumulative return during Bull/Bear/Sideways regimes | Bull >> Bear |
| 18 | Luck vs Skill | CAGR drop when best 1/5/10 days removed | stable |
| 19 | Alpha Half-Life | avg forward return 1/3/6/12m after top-quartile month | positive decay |
| 20 | Crash Resistance | return during Covid 2020 / Correction 2022 / Selloff 2024 | > -20% |

### 3 Composite Scores

**Conviction** = Consistency×30% + Wealth R²×25% + Trend Eff×20% + Time Above Water×15% + Pain-to-Gain(inv)×10%

**SWAN** = Consistency×25% + Time Above Water×25% + Recovery Speed(inv)×20% + Trend Eff×15% + Ann. Vol(inv)×15%

**Compounding Quality** = CAGR×35% + Wealth R²×35% + Recovery Factor×15% + DD Frequency(inv)×15%

All sub-metrics normalised via `_norm(v, lo, hi, invert)` → 0–100 before weighting.

### 7 Archetypes (priority waterfall)

| Priority | Archetype | Trigger |
|----------|-----------|---------|
| 1 | Elite Compounder | Conviction ≥ 80 AND Compounding ≥ 75 |
| 2 | Steady Grinder | Conviction ≥ 70 AND SWAN ≥ 70 |
| 3 | Lucky Speculator | Skill Ratio < 0.4 |
| 4 | Anti-Fragile Growth | Anti-Fragility > 0.2 |
| 5 | Volatile Performer | Conviction ≥ 60 AND Compounding < 50 |
| 6 | Capital Trap | Time Under Water > 60% |
| 7 | Mean Reverter | (default — none of the above) |

Regime conditioning uses `get_market_regime_series_if_ready()` — non-blocking. Returns `{}` if regime series not yet computed; regime performance section shows `—` for all values in that case.

### Crash Periods

| Name | Dates | Event |
|------|-------|-------|
| Covid 2020 | 2020-02-17 → 2020-03-23 | India lockdown sell-off |
| Correction 2022 | 2022-01-01 → 2022-06-17 | Global rate hike cycle |
| Selloff 2024 | 2024-09-27 → 2024-11-01 | FII outflows + election uncertainty |

---

## 5. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, Material UI |
| Design | `usePalette()`, `useTokens()` — CARD, BORDER, PAPER2, CYAN |
| Charts | Highcharts (`area` for drawdown history, `line` polar for DNA Radar via `HighchartsMore`) |
| State | `useState`, single `useEffect` per symbol change, `useMemo` for archetype grouping |
| Fonts | IBM Plex Mono (all numbers + tickers), IBM Plex Sans (body), IBM Plex Sans Condensed (section heads, labels) |
| API | `stockHealthApi.getReport(symbol)`, `stockHealthApi.getScan()` |
| Backend service | `stock_health_service.py` — `_analytics()` (pure NumPy), `_batch_warmup_all()` (4 bulk DuckDB queries), `start_scan_warmup()` (parquet-first) |
| Persistence | `data_lake/derived/stock_health/scan.parquet` — 478 symbols, ~13 KB, keyed by `computed_date` |
| Refresh | `POST /api/stock-health/scan/invalidate` — deletes parquet, triggers background recompute |

---

## 6. Suggestions

1. **Add a cross-archetype comparison table** — let users pick 2–3 archetypes and see their median Conviction / SWAN / CAGR / Max DD side-by-side. Helps with portfolio construction (e.g., mix 2 Elite Compounders + 1 Anti-Fragile for stress diversification).
2. **Archetype time-series** — track how many stocks fall into each archetype over time (compute monthly, store in derived parquet). A rising Capital Trap count is a market health warning signal.
3. **Regime-conditional archetype filter** — when Breadth < 40 (bearish market), only Anti-Fragile and Steady Grinder archetypes should qualify for new longs. Add a regime-aware filter toggle to the scanner.
4. **Portfolio builder integration** — "Add to Portfolio" button in scanner rows → assembles a portfolio from selected stocks, computes blended Conviction/SWAN/CQ. Directly supports the portfolio construction mission.
5. **Invalidate on ingestion pipeline completion** — wire `POST /api/stock-health/scan/invalidate` to the end-of-day ingestion script so the parquet refreshes automatically after new price data arrives. Currently a manual call.
6. **MetricRow → shared component** — extract `MetricRow` (collapsible explanation panel) and `ScoreRing` to `src/components/shared/`. Both are useful on the Stock page (`/stock/:symbol`) and any future fundamental analysis page.
7. **Drawdown chart decimation** — full `drawdown_series` is ~1,500 points per stock. Decimate to weekly (every 5th point) for the chart render; keep full data for the peak-drawdown computation. Reduces Highcharts repaint time from ~120ms to ~25ms.
