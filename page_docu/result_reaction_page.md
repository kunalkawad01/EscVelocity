# ResultReactionPage — `/result-reaction`

## 1. What It Is Doing

A read-only scanner, structured like the Live Screener: one row per F&O underlying (~209 symbols), showing how the stock actually traded around its **last 4 quarterly results**. For each symbol: Day -1 (the trading day before the result), Day 0 (the announcement day itself), and Day +1 (the next trading day) — averaged across the last 4 quarters, plus a win rate (how often Day 0 was positive). Click a row to see the individual quarter-by-quarter breakdown with exact dates.

Result dates are not user-supplied or hand-maintained — they're pulled live from **NSE's own public corporate event calendar**, no manual data entry.

---

## 2. Optimization

- **Parquet-first, 7-day freshness window** (`data_lake/derived/result_reaction/scan.parquet`) — mirrors the Stock Health scanner's pattern, but with a longer freshness window than "today." Result dates only change once a quarter; re-hitting NSE for all 209 symbols every single day (as Stock Health does for price-derived metrics) would be wasted load on an external host for data that hasn't changed. 7 days balances "catches a newly-announced quarter reasonably soon" against "don't hammer NSE daily for nothing."
- **Throttled external fetch** — 0.35s delay between NSE calls across ~209 symbols (~75s of delay alone, batch runs ~2 min total). NSE's event-calendar endpoint works without cookies/auth, but hitting it back-to-back for 209 symbols with no delay risks bot-detection blocking (Akamai headers are visible on every response).
- **Never runs synchronously at startup** — unlike the critical-path prewarm tasks (regime, delivery, indicators), this is a background-prewarm task (`start_scan_warmup` in `_background_prewarm`), same tier as Stock Health's archetype scan. It talks to an external, rate-limited host — it must never block server startup or compete with it.
- **One bulk DuckDB fetch per symbol, not per quarter** — `_reaction_for_symbol` pulls the symbol's full close/date history once, then does the day -1/0/+1 lookup for all 4 quarters via `bisect_left` on the in-memory date array (pure Python/NumPy, no repeat DuckDB round-trips).
- Partial/stale-serving pattern: the scan response always serves whatever's cached (even stale, even empty-with-a-progress-counter) and never blocks — `ready: false` just means a background refresh is in flight.

---

## 3. Lessons Learnt

- **NSE's own `purpose` field on the event-calendar API is unreliable — do not trust it.** For TCS, every quarterly-results board meeting since mid-2024 is filed under `purpose: "Results/Dividend"` or `"Dividend/Other business matters"` instead of `"Financial Results"`. A naive `purpose == "Financial Results"` filter silently drops recent quarters and falls back to whatever older rows happen to still match — for TCS this meant only two rows from 2004-2005 survived the filter, and the reaction computation then correctly rejected them as outside the covered price history, returning an empty result for a symbol that obviously has results data. Caught by spot-checking RELIANCE (worked fine, modern `purpose` labels) against TCS (silently broken) in the same smoke test — a single-symbol test would have hidden this.
  - **Fix**: filter on the free-text `bm_desc` field instead (`"financial result" in bm_desc.lower()`), which NSE populates consistently regardless of how `purpose` was filed. Verified across TCS/RELIANCE/HDFCBANK/BHARATFORG — all return a clean, quarterly-spaced (~90 day gaps) date series with no duplicates.
  - **General lesson**: when consuming any third-party categorical field (`purpose`, `category`, `type`), validate it against the free-text description on at least 3-4 real examples before trusting it as a filter — categorical tagging on data you don't control is a common silent-failure point.
- **The announcement date alone doesn't tell you before/after market hours.** NSE's event-calendar gives a board-meeting date but not a timestamp. Indian companies usually release results after market close, but some release pre-market. Rather than guess per-company, the page computes all three of Day -1 / Day 0 / Day +1 so the "real" reaction (whichever day it actually happened) is always one of the three columns — Day 0 catches pre-market releases, Day +1 catches the (more common) after-close releases.
- **NSE's event-calendar JSON/CSV API needs no auth or cookies** — confirmed via plain `curl` with just a browser User-Agent header, 200 OK, full multi-year history returned directly (no bot-check page, no session cookie dance). Much simpler than scraping the page itself or driving a browser.

---

## 4. Business Logic

- **"Day 0" = the first trading day on/after the NSE-reported board-meeting date.** Weekends/holidays are handled by `bisect_left` finding the next actual trading day in the symbol's own `equities_prices` history — no separate holiday calendar needed.
- **Day -1 / Day 0 / Day +1 are each independent one-day returns**, not a cumulative 3-day window: Day -1 = close[T-1]/close[T-2]-1, Day 0 = close[T0]/close[T-1]-1, Day +1 = close[T+1]/close[T0]-1.
- **Win rate** = fraction of the (up to 4) quarters where Day 0's return was positive — a crude "does this stock tend to pop or drop on results" signal, not a statistically rigorous edge (n=4 per symbol is far too small for that; treat it as a quick glance, not a backtest).
- A symbol can resolve fewer than 4 quarters (or none) if: NSE has no "financial result"-flagged events for it, or the matched date falls outside the symbol's covered price history (too recent — no T+1 bar yet — or predates the ingested history). These show as `error` on the row rather than crashing the scan.
- Universe is the same ~209-symbol F&O list used by `/charts` and `/live-screener` (`marketdna-data/FO.csv`) — not NIFTY 50, not NSE 500.

---

## 5. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, MUI `Table`, `usePalette()`/`useTokens()` — Live Screener's sortable-table pattern (click header to sort, click row to expand) |
| State | Local component state; polls `GET /scan` every 3s while `ready=false`, same pattern as Stock Health's Archetype Scanner |
| API client | `src/api/resultReactionApi.ts` — `GET /scan`, `POST /scan/invalidate` |
| Backend | FastAPI router `app/routers/result_reaction.py` → service `app/services/result_reaction_service.py` |
| External data | NSE public event-calendar API (`nseindia.com/api/event-calendar`) — no auth, fetched via `requests` |
| Price data | DuckDB `equities_prices` view (existing hive-partitioned parquet) |
| Cache | Polars parquet at `data_lake/derived/result_reaction/scan.parquet`, 7-day freshness window |

---

## 6. Suggestions to Achieve the Objective

1. **IV/options-implied move comparison** — once implied-move data is handy (see `/expected-move`), show "expected move vs actual Day 0 move" per quarter to flag chronic over/under-reaction.
2. **Sector/peer grouping** — group rows by sector (reusing `sector_heatmap_service`'s taxonomy) to spot sector-wide earnings-reaction patterns, not just single-stock ones.
3. **Volume confirmation on Day 0** — a big price move on thin volume reads differently than the same move on a volume spike; the delivery/volume data already ingested could be joined in.
4. **Longer lookback toggle** (8/12 quarters instead of a fixed 4) — useful for stocks with especially volatile or especially boring earnings histories, at the cost of a slower NSE fetch per symbol.
