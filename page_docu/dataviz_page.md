# DataVizPage — `/dataviz`

## 1. What It Does

Returns Intelligence dashboard for NSE 500 stocks (~1,025 lines + `DataVizAnalyticsSections.tsx`). Answers "how did every stock actually perform across multiple time horizons, and what does the distribution look like?"

**Inline sections** (defined in `DataVizPage.tsx`):

| Section | Component | What |
|---------|-----------|------|
| Cross-Sectional Returns | `SnapshotSection` | Bar chart of top/bottom N winners and losers for a selected return horizon |
| Symbol Return History | `HistorySection` | Bar chart of one symbol's return metric over full available history |
| Return vs Volatility Scatter | `ScatterSection` | XY scatter (return × std dev) with quadrant analysis and median crosshairs |
| Stocks Above 200 SMA — Weekly | `Above200Section` | Area chart of % (or count) of stocks above 200-day SMA, weekly frequency |

**Analytics sections** (split into `DataVizAnalyticsSections.tsx` for file-size reasons):
`HistogramSection`, `VolTermStructureSection`, `CrossVolSection`, `RiskAdjRankingSection`, `CalendarSection`, `MultiSMASection`, `ADLineSection`, `CorrMatrixSection`, `AlphaBetaSection`.

**Return horizons** (11 total):
1d, 5d (1W), 20d (1M), 50d (2½M), 1Y, 2Y, 3Y, CAGR 1Y, CAGR 2Y, CAGR 3Y, CAGR 5Y

**Universe**: 500 NSE stocks (hero stat strip: "500 NSE symbols, 6yr history, ~150ms API, 11 horizons").

**Quadrant analysis** in ScatterSection (split by median return and median std dev):
- Sweet Spot: High Return · Low Vol
- Momentum: High Return · High Vol
- Defensive: Low Return · Low Vol
- Avoid: Low Return · High Vol

**Above 200 SMA chart**: two view modes (% and Count) toggled inline. Reference lines at 20%, 50%, 80% in % mode. Latest stats strip shows week date, N above / total, and % above (green ≥ 50%, red < 50%).

**Load pattern**: all sections require an explicit "Load Chart" button click — no data fetches on mount. This prevents cold-start waterfall on a page with 13 sections.

---

## 2. Optimization

- Each section manages its own fetch state independently — no shared loading context. If two sections are loaded simultaneously they race without coordination. A shared `DataVizContext` with per-section cache keys would unify this.
- `SnapshotChart` and `HistoryChart` use `useMemo` on Highcharts options — correct. `ScatterChart` and `Above200Chart` do the same — good pattern.
- `DataVizAnalyticsSections.tsx` is a split for file-size only, not for lazy loading. Add `React.lazy` + `Suspense` around the analytics sections block so the 9 heavy sections don't parse on initial load.
- `NIFTY50_SYMBOLS` hardcoded inside `HistorySection` — the full 500-stock universe for the snapshot endpoint does not need listing client-side (server returns it). Only the symbol picker for History needs a list; consider fetching `/api/dataviz/symbols` instead.
- Highcharts chart width is forced via `.highcharts-container { width: 100% !important }` — this works but causes a flicker on resize. Use `Highcharts.chart.reflow()` via a ResizeObserver on the container instead.

---

## 3. Lessons Learnt

- Splitting analytics sections into a separate file (`DataVizAnalyticsSections.tsx`) keeps individual file size manageable but imports are still synchronous — it gives the appearance of separation without the bundle-split benefit. Always pair file splits with `React.lazy`.
- The `StatChip` and `RunBtn` shared components defined locally in `DataVizPage.tsx` are identical to similar components in other pages — they should live in `src/components/shared/`. Do not define them again in a third page.
- The `Above200Section` loads the full weekly series (5+ years × weekly = ~260 bars) on every click. This is cheap. The section is also the most useful breadth monitor on the page — consider loading it automatically on page mount rather than requiring a button click.
- Quadrant counts in `ScatterSection` use median as the split point, not zero. This is intentional — it creates 4 balanced quadrants regardless of market direction. Document the split logic in the tooltip.

---

## 4. Business Logic

**Cross-Sectional Snapshot** (`/api/dataviz/snapshot?horizon=ret_1d&top_n=30`):
- Returns top N and bottom N stocks by return for the selected horizon
- Stats: n_symbols, n_positive, n_negative, avg, median, max_val, min_val, as_of date
- Chart: losers sorted most-negative first (left), winners sorted least-positive last (right), color-coded red/green

**Symbol Return History** (`/api/dataviz/history?symbol=X&metric=ret_1d`):
- Returns time series of a single return metric for one symbol
- Derived stat: "Positive Days %" = count(value ≥ 0) / total × 100

**Return vs Volatility Scatter** (`/api/dataviz/scatter?horizon=1m`):
- Returns (symbol, ret, std) for each stock plus median_ret, median_std, and quadrant counts
- Scatter horizons: 1w, 1m, 3m, 1y, 3y (different from the bar chart horizons)

**Above 200 SMA Weekly** (`/api/dataviz/above200/weekly`):
- Returns list of `{week_date, n_above_200, total_symbols, pct_above_200}`
- Reference thresholds: 80% = bull breadth, 50% = neutral, 20% = bear breadth
- Toggling % / Count view is client-side only — no re-fetch

---

## 5. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, Material UI |
| Charts | Highcharts (column, scatter, area) — no Highstock, no annotations module |
| API | `datavizApi` from `../api/datavizApi` |
| Types | `ReturnSnapshotResponse`, `ReturnHistoryResponse`, `ScatterResponse`, `Above200WeeklyResponse` from `../types/dataviz` |
| Design | `usePalette()`, `useTokens()` — CARD, INPUT_SX, BORDER, PAPER2 tokens; `SectionHead`, `RunBtn`, `StatChip` local components |
| Fonts | IBM Plex Sans (body), IBM Plex Mono (numbers/tickers) |
| State | Each section independent: `useState` for loading / error / data |

---

## 6. Suggestions to Achieve the Objective

1. **Auto-load Above 200 SMA on mount**: this is the most useful breadth indicator on the page and has low API cost (~260 data points). Load it automatically instead of requiring a button click — it sets market context for interpreting all other charts.
2. **Link snapshot to history**: clicking a bar in the `SnapshotChart` should auto-populate the symbol picker in `HistorySection` and load that symbol's history. The two sections answer complementary questions — cross-section then drill-down.
3. **Regime overlay on history chart**: add a background shading band for the market regime during each period (bull / bear / sideways). A stock's return history in isolation is less informative than return history conditioned on market regime.
4. **Percentile rank table**: after loading the scatter, show a table ranking each stock by return/vol quadrant with its percentile rank within the universe. Adds the "where does this stock sit vs the field" answer to each bar chart.
5. **Export to CSV**: `SnapshotSection` and `ScatterSection` results are high-value research data — add a download button (plain CSV from the API response) so users can use the data in external tools.
