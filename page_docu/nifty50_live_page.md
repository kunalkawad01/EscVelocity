# Nifty 50 Live Page — `/nifty50-live`

Single-page live view of the NIFTY 50 index: real-time tick, breadth, sector rotation, India VIX,
the full option chain, and intraday price-vs-OI — everything needed to read the index's structure
during market hours without leaving the page.

## What It Does

Ten stacked sections, top to bottom:

- **Hero + live index tick.** LTP/change/change% via a persistent Kite WebSocket (`/ws/nifty50`); a
  `LiveBadge` shows `LIVE · TICK` (green, pulsing) while connected or `CLOSED · LAST AVAILABLE`
  (amber) otherwise. REST fallback (`get_index_state`) seeds the page before the socket connects.
- **NIFTY 50 chart.** Candlestick, 14 timeframe buttons (`1min`…`5y`). Clicking a row in the
  constituents board re-targets the same chart at that stock; clicking the header/price reverts to
  the index.
- **All 50 Constituents board.** Two-column live list off the same websocket message, sortable by
  weight or today's return.
- **Market Breadth strip.** Live advance/decline count + % of the 50 above SMA20/50/200 + a 0–100
  breadth score, all scoped to the 50 constituents (see Lessons Learnt — this deliberately does not
  reuse `/api/regime/breadth`, which is NSE-500-wide).
- **India VIX.** Live LTP/change header + an intraday/historical area chart (Daily/1M/3M/1Y tabs).
- **Contributors & Detractors.** Top-10 point contributors/detractors by a broker-style
  points-contribution approximation (see Business Logic).
- **Sector Heatmap (Nifty 50).** Colored tiles per sector (1-day return + momentum score), reusing
  `sector_heatmap_service` with `universe=nifty50` — no new backend logic.
- **Option Chain.** Expiry selector (up to 8 weekly NIFTY-index expiries) → spot/ATM/PCR/max-pain
  stats, a strike ladder (CE OI vs PE OI), and two column charts (OI by strike, change-in-OI by
  strike).
- **PCR & Max Pain Trend.** Intraday line chart of PCR + max pain + spot, built by polling a live
  full-chain OI snapshot every 30s (not the ingested/EOD chain — see Lessons Learnt).
- **Strike Charts (ATM ±3).** 7 Call + 7 Put dual-axis intraday charts (price line + step-line OI),
  one per strike from ATM−3 to ATM+3.
- **Top Gainers & Losers.** 6 bar charts (Daily / Weekly / 1 Month / 3 Month / YTD / 12 Month), each
  the top-5 gainers (green) + top-5 losers (red) among the 50 constituents. Placed last on the page
  by design.

## Optimization

- **One websocket, not fifty.** `/ws/nifty50` pushes the index tick + all 50 constituent ticks in a
  single JSON message once a second, off the same `KiteTicker` callback `live_trading_service`
  already runs for other live pages.
- **Shared option-chain state.** `useNiftyOptionChain()` is the single source of `expiry` + `chain`
  for the Option Chain section, the Strike Charts section, and the PCR Trend chart — three sections,
  one 5s-refreshed fetch, not three.
- **Movers + SMA breadth share one DuckDB query.** `_compute_movers_history()` pulls 400 days of
  closes for the 50 constituents once, caches it per calendar date, and both `get_period_movers()`
  (5 of 6 periods) and `get_breadth()` (SMA20/50/200 breadth) read from the same cached result — no
  duplicate round-trip. Only the `daily` movers leg and the advance/decline count are live
  (re-derived from ticks on every call, no DB hit).
- **PCR/max-pain: one batched `kite.quote()` per poll.** ~82 instruments (ATM±20, CE+PE) fetched in a
  single Kite call rather than per-strike calls.
- **Strike charts reuse the existing per-minute cache.** `GET /api/fno/optionchain/{symbol}/strike-chart`
  already existed for the F&O Tactical page's single-strike view; calling it 7× for ATM±3 rides the
  same `live_trading_service._strike_chart_cache` (keyed per `symbol:strike:expiry`, refreshed at
  most once a minute), so repeated frontend polls within the same minute are free.
- **Sector heatmap and option-expiry list are pure reuse** — zero new backend computation, just
  narrower `universe=nifty50` / NIFTY-specific query parameters on existing services.

## Lessons Learnt

- **`options_service.get_oi_analysis()` is EOD/ingestion-cached, not live.** It serves whatever
  `ingest_option_chain.py` last wrote to parquet — unchanged until someone reruns that script. A
  first version of the PCR/max-pain trend polled this and deduped identical consecutive snapshots,
  which meant it got stuck at exactly one point for the entire session (and a 1-point line chart with
  markers disabled renders as nothing — looked "broken" with no error anywhere). Fixed by computing
  PCR/max-pain from a live batched `kite.quote()` over the full chain instead, and enabling small
  point markers so sparse series stay visible while they build up.
- **`_load_prev_oi_map()`'s "yesterday" was a calendar day, not a trading day.** OI-change came back
  `NULL` every Monday (and after any holiday gap) because `ref_date - 1 calendar day` lands on a
  weekend with no ingested partition, even though Friday's data exists. Fixed by scanning for the
  actual latest `date=*` partition strictly before `ref_date` — the same pattern
  `fno_tactical_service._get_fut_meta()` already uses for `futures_chain`.
- **A brand-new symbol has no "yesterday" at all, no matter how the lookback is fixed.** NIFTY
  index-options ingestion was added mid-project; its first-ever ingested day necessarily has
  `oi_change = NULL` for every strike (no prior day exists yet, full stop). `OiByStrikeChart` now
  detects "every value is null" and shows an explanatory empty state instead of a blank chart.
- **`/api/regime/breadth` is NSE-500-wide (488 symbols), not Nifty-50-scoped**, despite living under
  `/api/regime` and this page being explicitly Nifty-50-only everywhere else. Wiring it into the
  Breadth Strip would have shown numbers that don't reconcile with the rest of the page. Built
  `nifty50_service.get_breadth()` instead, scoped to the 50 constituents.
- **Backend runs without `--reload` in this dev setup** — every new route/service change needs an
  explicit restart (`Stop-Process` on the port-8000 listener + relaunch uvicorn) before `curl`
  testing it; a 404 immediately after an edit almost always means "haven't restarted yet," not a
  routing bug.
- **Fast scrolling in browser-automation screenshots can show all-black frames** that aren't real
  rendering bugs — Highcharts-in-CSS-grid paint lags a fast programmatic scroll. Verify with
  `getBoundingClientRect()` on `.highcharts-container` elements (or `scrollIntoView` + a short wait)
  before concluding a section failed to render.

## Business Logic

- **Points contribution** (Contributors panel): `points_i = weight_i% × index_prev_close ×
  change_pct_i% / 100`. A broker-style approximation, not NSE's exact free-float-divisor
  methodology (that needs live free-float share counts this pipeline doesn't have). Weights + each
  row's source/confidence (official NSE top-10 vs cross-referenced estimate) live in
  `marketdna-data/nifty50_weights.csv`.
- **Movers periods:** `daily` = live tick `change_pct`. `weekly/1m/3m/ytd/12m` = `(latest_close −
  base_close) / base_close`, where `base_close` is the closing price of the latest trading day at or
  before a target calendar date (`today − 7d` / `−30d` / `−91d` / prior-year Dec 31 / `today − 365d`
  respectively) — never a fixed trading-day offset, so it's robust to holidays/gaps.
  Top-5 gainers/losers are picked per period, independently.
- **SMA breadth:** `pct_above_smaN` = % of the 50 constituents whose latest close is above the
  simple mean of their trailing N closes (N = 20/50/200); `breadth_score = pct20×0.30 + pct50×0.40 +
  pct200×0.30`; labels mirror `regime_service`'s thresholds (`≥70` Broad Participation, `≥50`
  Moderate, `≥30` Narrow, else Poor).
- **PCR** = `Σ PE open interest / Σ CE open interest` across the live ATM±20 chain. **Max pain** =
  the strike minimizing total option-buyer payout, `Σ max(0, P−K)×CE_OI + max(0, K−P)×PE_OI` over all
  candidate expiry prices `P` (reuses `options_service._compute_max_pain`).
- **ATM window (strike charts):** the constituent strike closest to `chain.atm_strike`, then 3 strikes
  either side by index position in the sorted strike list (not by price distance) — so the window is
  always exactly 7 strikes even where the strike interval isn't perfectly uniform.

## Tech Stack

- **Backend:** `app/routers/nifty50.py` (`/api/nifty50/*` + `/ws/nifty50`) · `app/services/
  nifty50_service.py`. Reuses `live_trading_service` (KiteTicker cache, `NIFTY50_WEIGHTS`,
  `get_nifty_constituent_ticks`, `_get_nfo_instrument`), `options_service` (`get_oi_analysis`,
  `_compute_max_pain`, `get_expiries`), `app/routers/fno.py` + `fno_tactical_service`
  (`get_strike_chart`, reused as-is for the ATM±3 charts), and `sector_heatmap_service`
  (`get_heatmap(universe="nifty50")`). Weight table: `marketdna-data/nifty50_weights.csv`.
- **Frontend:** `src/pages/Nifty50LivePage.tsx` (single file, all sections as local components) ·
  `src/api/nifty50Api.ts` · `src/types/nifty50.ts`. Also imports `optionsApi` (option chain),
  `fnoApi` (strike charts), `sectorHeatmapApi` (sector tiles). Highcharts/Highstock: candlestick
  (index/VIX chart), column (OI-by-strike, movers), bar (gainers/losers), dual-axis line (PCR trend,
  strike price-vs-OI).
- **Route/nav:** `/nifty50-live` registered in `App.tsx`; linked from `Navbar.tsx`.

## Suggestions

1. **NSE's real divisor methodology** for points-contribution, if/when a free-float share-count
   source becomes available — the current broker-style weight approximation is clearly labeled but
   still an approximation.
2. **Persist PCR/max-pain history to parquet** (e.g. `data_lake/derived/nifty50/pcr_history/`) so the
   intraday trend survives a backend restart instead of resetting to an empty series.
3. **Feed live full-chain OI into "Change in OI by Strike" too** — it currently only updates when
   `ingest_option_chain.py` is manually rerun; the live-quote plumbing built for the PCR trend could
   drive that chart live as well.
4. **Sector heatmap tile sizing** could reflect sector weight/market-cap instead of a uniform grid,
   matching the visual convention of the standalone `/sector-heatmap` treemap-style page.
5. **VIX ↔ NIFTY overlay** — a small inverse-correlation strip (VIX up / NIFTY down days) would give
   the VIX section more standalone analytical value beyond a bare price chart.
