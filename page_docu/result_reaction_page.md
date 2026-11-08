# ResultReactionPage — `/result-reaction`

## 1. What It Is Doing

A read-only scanner, structured like the Live Screener: one row per F&O underlying (~209 symbols), showing how the stock actually traded around its **last 4 quarterly results**. For each symbol: Day -1 (the trading day before the result), Day 0 (the announcement day itself), and Day +1 (the next trading day) — averaged across the last 4 quarters, plus a win rate (how often Day 0 was positive). Click a row to see the individual quarter-by-quarter breakdown, now extended to **Day +2 through Day +5** (close-to-close returns, exact dates) with exact dates.

Per quarter, a **"View Charts" toggle** opens a 7-tile grid (Day -1 through Day +5) of that exact calendar date's own **intraday candlestick chart** — not a relative lookback window like `/charts`' timeframes, a specific historical trading session. Each tile shows two separate return numbers (close-to-close "vs prev close", matching the table, and the day's own open→close "intraday" move — a day can gap hard overnight yet trade flat intraday, or vice versa, and the two numbers answer different questions) plus a dotted "Prev Close" reference line.

Result dates are not user-supplied or hand-maintained — they're pulled live from **NSE's own public corporate event calendar**, no manual data entry. Intraday candles are pulled live from Kite's historical API on demand (only when a quarter's "View Charts" is opened), not pre-scanned for all 209 symbols × 4 quarters.

---

## 2. Optimization

- **Parquet-first, 7-day freshness window** (`data_lake/derived/result_reaction/scan.parquet`) — mirrors the Stock Health scanner's pattern, but with a longer freshness window than "today." Result dates only change once a quarter; re-hitting NSE for all 209 symbols every single day (as Stock Health does for price-derived metrics) would be wasted load on an external host for data that hasn't changed. 7 days balances "catches a newly-announced quarter reasonably soon" against "don't hammer NSE daily for nothing."
- **Throttled external fetch** — 0.35s delay between NSE calls across ~209 symbols (~75s of delay alone, batch runs ~2 min total). NSE's event-calendar endpoint works without cookies/auth, but hitting it back-to-back for 209 symbols with no delay risks bot-detection blocking (Akamai headers are visible on every response).
- **Never runs synchronously at startup** — unlike the critical-path prewarm tasks (regime, delivery, indicators), this is a background-prewarm task (`start_scan_warmup` in `_background_prewarm`), same tier as Stock Health's archetype scan. It talks to an external, rate-limited host — it must never block server startup or compete with it.
- **One bulk DuckDB fetch per symbol, not per quarter** — `_reaction_for_symbol` pulls the symbol's full close/date history once, then does the day -1/0/+1 lookup for all 4 quarters via `bisect_left` on the in-memory date array (pure Python/NumPy, no repeat DuckDB round-trips).
- Partial/stale-serving pattern: the scan response always serves whatever's cached (even stale, even empty-with-a-progress-counter) and never blocks — `ready: false` just means a background refresh is in flight.
- **Intraday charts are strictly on-demand, per quarter, never batch-scanned.** 209 symbols × 4 quarters × 7 days would be ~5,850 Kite `historical_data` calls if ever prefetched eagerly — instead `ResultDayChartGrid` only fires its 7 (one per day) fetches when a specific quarter's "View Charts" toggle is opened, and each exact-date response is cached in-process for 24h (closed trading sessions never change, so there's no reason to re-fetch within a server's lifetime).
- **The prev-close line and intraday % are back-derived from the same candle payload already fetched for the chart — no second API call.** `prevClose = lastCandleClose / (1 + closeToClosePct)` and `intradayPct = (lastClose - firstOpen) / firstOpen` are both pure arithmetic on data the tile already has.

---

## 3. Lessons Learnt

- **NSE's own `purpose` field on the event-calendar API is unreliable — do not trust it.** For TCS, every quarterly-results board meeting since mid-2024 is filed under `purpose: "Results/Dividend"` or `"Dividend/Other business matters"` instead of `"Financial Results"`. A naive `purpose == "Financial Results"` filter silently drops recent quarters and falls back to whatever older rows happen to still match — for TCS this meant only two rows from 2004-2005 survived the filter, and the reaction computation then correctly rejected them as outside the covered price history, returning an empty result for a symbol that obviously has results data. Caught by spot-checking RELIANCE (worked fine, modern `purpose` labels) against TCS (silently broken) in the same smoke test — a single-symbol test would have hidden this.
  - **Fix**: filter on the free-text `bm_desc` field instead (`"financial result" in bm_desc.lower()`), which NSE populates consistently regardless of how `purpose` was filed. Verified across TCS/RELIANCE/HDFCBANK/BHARATFORG — all return a clean, quarterly-spaced (~90 day gaps) date series with no duplicates.
  - **General lesson**: when consuming any third-party categorical field (`purpose`, `category`, `type`), validate it against the free-text description on at least 3-4 real examples before trusting it as a filter — categorical tagging on data you don't control is a common silent-failure point.
- **The announcement date alone doesn't tell you before/after market hours.** NSE's event-calendar gives a board-meeting date but not a timestamp. Indian companies usually release results after market close, but some release pre-market. Rather than guess per-company, the page computes all three of Day -1 / Day 0 / Day +1 so the "real" reaction (whichever day it actually happened) is always one of the three columns — Day 0 catches pre-market releases, Day +1 catches the (more common) after-close releases.
- **NSE's event-calendar JSON/CSV API needs no auth or cookies** — confirmed via plain `curl` with just a browser User-Agent header, 200 OK, full multi-year history returned directly (no bot-check page, no session cookie dance). Much simpler than scraping the page itself or driving a browser.
- **Kite's minute-level `historical_data` retention is longer than assumed** — empirically verified (RELIANCE, 1/2/3/6/9/12 months back, `minute`/`5minute`/`15minute`/`60minute`/`day` intervals) that 1-minute candles are available at least 12 months back, not the ~60-day window often cited for retail broker APIs. This is what makes the per-quarter intraday chart grid viable for all 4 quarters, not just the most recent one — re-verify if this ever silently breaks for older quarters, since it's an unwritten Kite behavior, not a documented contract.
- **A fixed-height Highcharts tile inside a flex-laid-out card needs `chart.height` set explicitly — relying on container measurement is a race.** `HighchartsReact` instantiates the chart in a `useEffect`/`useLayoutEffect` that reads the container's current rendered height; in a `display:flex, flexDirection:column` ancestor chain (unlike an `aspectRatio`-based box, which is intrinsically resolvable from width alone), that height isn't always settled by the time Highcharts measures it, so it silently falls back to Highcharts' own 400px default and overflows a visually-240px card — no error, no warning, just a chart that renders too tall and gets clipped by the card's own bounds. Fixed by passing `chart: { height: 240 }` directly in the options, which Highcharts treats as authoritative regardless of DOM timing. Verified via DOM inspection (`getComputedStyle` on the `.highcharts-container` ancestor chain) that every ancestor correctly resolved to 240px except the Highcharts-managed container itself, which had explicitly set itself to 400px inline — confirming this was Highcharts' own fallback, not a CSS bug. Apply this pattern (explicit `chart.height`, never bare percentage/flex sizing) to any new fixed-size (non-aspect-ratio) Highcharts tile.
- **A plot line's value doesn't auto-extend the y-axis range.** The "Prev Close" dotted line was initially invisible on gappy days (e.g. Day -1 opening well below/above its own prior close) because Highcharts' auto-scaled axis range comes purely from the series' own OHLC extremes — a `yAxis.plotLines` entry outside that range just renders off-canvas with no warning. Fixed with `yAxis.softMin`/`softMax` set to the prev-close value — "soft" because it only *widens* the range when the real data doesn't already cover it, never shrinks a wider range. Plain `min`/`max` would have been wrong here (forces the exact bound, clipping real candle data on well-behaved days).

---

## 4. Business Logic

- **"Day 0" = the first trading day on/after the NSE-reported board-meeting date.** Weekends/holidays are handled by `bisect_left` finding the next actual trading day in the symbol's own `equities_prices` history — no separate holiday calendar needed.
- **Day -1 through Day +5 are each independent one-day returns**, not a cumulative window: Day N = close[T0+N]/close[T0+N-1]-1 for every offset, including the negative/zero cases. A quarter can resolve fewer than all 7 days if the symbol's covered price history runs out (e.g. a very recent result with no Day +5 bar yet) — missing days show as `null`/`—`, not zero.
- **Intraday open→close % (chart tiles only) is a different number from the table's close-to-close %** — the table always shows vs-prior-close (what the trading convention "Day N return" means), while each chart tile additionally shows that day's own open→close move, computed client-side from the same candle payload. They can point in different directions on a gap day.
- **Win rate** = fraction of the (up to 4) quarters where Day 0's return was positive — a crude "does this stock tend to pop or drop on results" signal, not a statistically rigorous edge (n=4 per symbol is far too small for that; treat it as a quick glance, not a backtest).
- A symbol can resolve fewer than 4 quarters (or none) if: NSE has no "financial result"-flagged events for it, or the matched date falls outside the symbol's covered price history (too recent — no T+1 bar yet — or predates the ingested history). These show as `error` on the row rather than crashing the scan.
- Universe is the same ~209-symbol F&O list used by `/charts` and `/live-screener` (`marketdna-data/FO.csv`) — not NIFTY 50, not NSE 500.

---

## 5. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, MUI `Table`, `usePalette()`/`useTokens()` — Live Screener's sortable-table pattern (click header to sort, click row to expand) |
| Charts | `src/components/charts/ResultDayChartGrid.tsx` — Highcharts `stockChart` candlesticks, one tile per day, reuses `MultiTimeframeGrid`'s lazy-fetch-on-expand pattern but keyed by exact date instead of relative timeframe |
| State | Local component state; polls `GET /scan` every 3s while `ready=false` (Stock Health's Archetype Scanner pattern); chart grid state (`chartsOpen`) keyed per `symbol-result_date` so each quarter's charts toggle independently |
| API client | `src/api/resultReactionApi.ts` — `GET /scan`, `POST /scan/invalidate`; `src/api/chartsApi.ts` (shared with `/charts`) — `getHistoryForDate(symbol, date)` for the per-day intraday candles |
| Backend | FastAPI router `app/routers/result_reaction.py` → service `app/services/result_reaction_service.py` (dates + close-to-close reaction); `app/routers/charts.py` → `fno_charts_service.get_history_for_date()` (intraday candles for an exact past date, generalized from the existing `get_history()`'s 'yesterday' branch) |
| External data | NSE public event-calendar API (`nseindia.com/api/event-calendar`) — no auth, fetched via `requests`; Kite `historical_data` for intraday candles |
| Price data | DuckDB `equities_prices` view (existing hive-partitioned parquet) — daily closes for the table; Kite historical API — intraday candles for the chart grid |
| Cache | Polars parquet at `data_lake/derived/result_reaction/scan.parquet`, 7-day freshness window (scan); in-process dict, 24h TTL, keyed `(symbol, date, interval)` (per-day intraday candles — a closed session is immutable, so this is effectively permanent per server lifetime) |

---

## 6. Suggestions to Achieve the Objective

1. **IV/options-implied move comparison** — once implied-move data is handy (see `/expected-move`), show "expected move vs actual Day 0 move" per quarter to flag chronic over/under-reaction.
2. **Sector/peer grouping** — group rows by sector (reusing `sector_heatmap_service`'s taxonomy) to spot sector-wide earnings-reaction patterns, not just single-stock ones.
3. **Volume confirmation on Day 0** — a big price move on thin volume reads differently than the same move on a volume spike; the delivery/volume data already ingested could be joined in. The intraday chart tiles already fetch per-candle `volume` from Kite but don't render it yet — a volume pane under each candlestick tile would be a small, self-contained next step using data already in hand.
4. **Longer lookback toggle** (8/12 quarters instead of a fixed 4) — useful for stocks with especially volatile or especially boring earnings histories, at the cost of a slower NSE fetch per symbol.
5. **Extend the chart grid past Day +5** — the table's columns and `QuarterReaction`'s day fields are currently fixed at -1..+5; going further would mean widening the model/table rather than just the chart grid, since the grid is driven off the same per-quarter date fields.
