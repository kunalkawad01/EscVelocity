# Live Screener Page — `/live-screener`

A single sortable table across the full F&O underlying universe (~209 symbols) — LTP,
day change %, open, previous close, high, low, and how far the live price sits from
each of those — fed by the same shared `/ws/charts` tick stream as `/charts`, with a
dynamic AND/OR return-condition filter builder, a click-to-expand 6-timeframe chart
snapshot per row, and two live hero charts (an equal-weighted F&O index rebased to 100
at 9:18, and advance-decline breadth) built client-side off the same tick stream.

## What It Does

- **Hero.** Same pattern as `/charts`: eyebrow badge + pulsing LIVE/CONNECTING indicator,
  headline, description, `SearchBox` (substring match on symbol), `N / 209 symbols` counter.
- **Open reference toggle (9:15 vs 9:18).** A two-way pill, "9:15 OPEN" / "9:18 OPEN", below
  the symbol counter. The raw 09:15 opening-auction print can be choppy; switching to 9:18
  re-bases every open-derived column and filter field (Open, From Open %, Give-back %,
  Recovery %, and the Low/High vs Open % filter fields) off the price traded at 9:18 instead.
  First switch triggers a bulk scan (~60-70s cold, "scanning 09:18 prints…" status, then "N
  symbols as of {timestamp}"; a RE-SCAN button re-fetches on demand); cached 120s server-side
  after that. Switching back to 9:15 is instant (no re-fetch, just stops applying the
  override). See Business Logic for exactly which fields this affects and how.
- **Two live hero charts, side by side below the Open Ref toggle:**
  - **F&O Equal-Weight Index (base 100 @ 9:18).** `EqualWeightIndexTile` — a single line,
    recomputed on every websocket tick as `100 × mean_i(ltp_i / open918_i)` across every
    symbol whose 9:18 reference has arrived (the same `refOpens` snapshot the Open Ref
    toggle uses — fetched automatically on page load, not gated behind the toggle). Header
    shows the current level and its %-change from 100. A new point is sampled at most once
    every 5s (ticks arrive ~1/sec; no need for a chart point that dense). Starts empty and
    draws forward live from whenever the page loads / the 9:18 scan completes — it does not
    backfill the index's shape from 9:18 to "now" if opened mid-session (see Suggestions).
  - **F&O Advance-Decline.** `AdvanceDeclineTile` — two lines (Advancing/GREEN,
    Declining/RED), counting how many of the ~209 F&O symbols currently sit above vs below
    their own previous close (`change_pct` vs yesterday, the same field the Chg % column
    uses — independent of the Open Ref toggle and the 9:18 scan). Header shows live
    ▲/▼/flat counts. Same 5s sampling and "draws forward live" behavior as the index tile.
- **One sortable table, not a grid of tiles.** Columns: Symbol · LTP · Chg % (vs yesterday's
  close) · Open · Prev Close · High · Low · From High % · From Low % · From Open % ·
  Give-back % · Recovery %. Clicking any column header sorts by it (ascending/descending
  toggle on repeat click); an arrow (▲/▼) marks the active sort column, a faint ⇅ marks the
  rest. Default sort: Chg % descending.
- **Recovery %** — also exposed as a filter field (see below): `(ltp − low) / (open − low) ×
  100`. 0% = still at the low, 100% = fully recovered to the open, >100% = now trading above
  the open. Color-coded the mirror of Give-back %'s tiers — ≤25% RED (barely off the low),
  25-75% AMBER, >75% GREEN (mostly/fully recovered) — since here a *higher* number is the
  bullish read, the opposite of Give-back %. `—` when the stock never traded below its own
  open (`open <= low`).
- **Give-back %** — how much of the day's open-to-high rally the live price has handed
  back: `(high − ltp) / (high − open) × 100`. 0% = still sitting at the high, 100% = a full
  round-trip back to the open, >100% = now trading below the open. Color-coded in 3 tiers
  (not signed +/−, since it reads as a continuum): ≤25% GREEN (still strong), 25-75% AMBER
  (partial fade), >75% RED (mostly/fully reversed). `—` when the stock never traded above
  its own open (`high <= open`) — there's no rally to give back. This is the single-column
  version of the 3-condition "rallied then faded back to open" screen (vs Today High /
  vs Today Open stacked with Match ALL) — see Lessons Learnt.
- **Row click expands all 6 timeframes at once.** Clicking a symbol's row toggles a second
  table row directly beneath it containing a `MultiTimeframeGrid` — 6 square candlestick
  tiles in a 3-column grid (same card chrome, candle coloring, tiny axis labels, and
  prev-close dotted line as `/charts`' `ChartTile`), each labeled with its own return%:
  **Today** (1D, live tick), **Yesterday** (the prior completed session only), **5-Day**,
  **1 Month**, **Quarterly** (3mo), **1 Year**. This is a snapshot view (every timeframe
  visible simultaneously), unlike `ChartTile` (one timeframe at a time via tabs) — so it's a
  sibling component (`MiniTfCard`) that mirrors `ChartTile`'s visual design but is locked to
  one fixed timeframe with no tabs/resolution toggle/add-to-cart. Multiple rows can be
  expanded at once; state is a `Record<symbol, boolean>` (see Business Logic — per-item
  toggle pattern).
- **Dynamic AND/OR return filter.** Unlike `/charts`' `LiveReturnFilterBar` (four fixed
  slots — vs yesterday close / today open / today high / today low — always AND-ed), this
  page's `ScreenerFilterBar` is an open-ended list: "+ ADD CONDITION" appends a row with a
  field `Select` (**LTP** / vs Yday Close / vs Today Open / vs Today High / vs Today Low /
  **Give-back %** / **Recovery %** / **Low vs Open %** / **High vs Open %** /
  **vs SMA20/50/100/200**), a 3-way op toggle (`<` / `>` / **B/W**), and a value box; any
  number of rows can target the same or different fields. Once 2+ conditions exist, a "Match
  ALL" / "Match ANY" toggle appears and decides whether the table requires every condition to
  pass (AND) or at least one (OR). No Apply step — re-evaluates instantly against the
  streaming tick (plus the bulk `screener-stats` snapshot for SMA/percentile fields — see
  below), same instant feel as `/charts`' live filters.
- **LTP is the one raw-price field — every other field is a %-return.** `isPriceField(field)`
  (`useScreenerFilters.ts`) drives the value box's unit: a leading `₹` and a `500`-style
  placeholder for LTP, vs the usual trailing `%` and `2`-style placeholder for everything
  else. LTP has no "vs OWN %ILE" mode (`pctileBandFor('ltp')` is `null`, same as Give-back
  %/Recovery %/vs-SMA — there's no "5-year distribution of this stock's own price" that would
  mean anything) — e.g. `LTP < 500` screens for stocks currently trading under ₹500.
- **"vs OWN %ILE" — compare against the stock's own history, not a fixed cutoff.** On a "vs
  Yday Close" or "vs Today Open" condition only, a "vs OWN %ILE" toggle appears next to the
  op buttons. Turning it on swaps the numeric value box for a Select of that symbol's own
  5-year return-percentile breakpoints (Min/25th/50th/75th/90th/Max — `between` is hidden in
  this mode, just `<`/`>` against the chosen breakpoint). E.g. **vs Yday Close < 25th %ile**
  finds stocks having an unusually weak day *for that specific stock* — a 1.2% drop might be
  completely ordinary for a high-vol name and already be a 25th-percentile-breaching move for
  a quiet one; a fixed numeric cutoff can't tell the difference, this can. Backed by
  `GET /api/charts/screener-stats` (see Business Logic), fetched once automatically on page
  load — a condition in this mode quietly passes every symbol (doesn't false-exclude) until
  that snapshot has loaded.
- **vs SMA20/50/100/200** — % distance of LTP from each moving average (`(ltp-smaN)/smaN×100`),
  same `screener-stats` snapshot. No percentile mode on these (no historical distribution of
  "distance from today's own SMA" to bind to) — fixed-number/`between` only.
- **Four derived session-shape fields, in two mirrored pairs:**
  - **Give-back % / Recovery %** — opposite directions of the same idea. Give-back %
    (`(high − ltp) / (high − open) × 100`, null unless `high > open`) is how much of an
    **upside** rally has been handed back. Recovery % (`(ltp − low) / (open − low) × 100`,
    null unless `open > low`) is how much of a **downside** decline has been clawed back —
    0% = still at the low, 100% = fully back to open, >100% = now trading above open. A
    stock whose range straddles its open (`low < open < high`, very common) has *both*
    values defined simultaneously — they describe different halves of the same session.
  - **Low vs Open % / High vs Open %** — opposite directions of "did the session ever cross
    the open," as distinct from `vsOpen` (which only reflects the *current* price). Low vs
    Open % (`(low − open) / open × 100`) positive means the stock has never traded *below*
    its own open all day. High vs Open % (`(high − open) / open × 100`) positive means it
    *has* traded above its own open at some point (even if it isn't right now — e.g. a stock
    that popped briefly then round-tripped back down). Example: filter `Low vs Open % >
    -0.01` for "held above open all day"; filter `High vs Open % < 0.01` for "never once
    traded above open" (see Lessons Learnt for why `-0.01`/`0.01` rather than `0`).
- **Between-range conditions.** Picking the **B/W** op on a condition swaps the single value
  box for two ("...and..."), e.g. **Give-back % B/W 60 and 90** — an inclusive range match,
  order-independent (typing 90-then-60 behaves identically to 60-then-90). Replaces what
  would otherwise need two stacked `>`/`<` conditions on the same field.
- **Quick filter buttons — "Never Above Open" / "Never Below Open".** Two one-click toggle
  chips above the condition list (`QUICK:` row) that add/remove one exact preset condition:
  "Never Above Open" → `High vs Open % < 0.001`, "Never Below Open" → `Low vs Open % >
  -0.001`. Clicking an active chip removes that exact condition rather than piling up
  duplicates (`useScreenerFilters.toggleQuickFilter`/`hasQuickFilter` match on
  field+op+value). Thresholds are `0.001`/`-0.001`, not exactly `0`, for the same reason the
  manual version of this screen needs it (see Lessons Learnt below) — a stock that's only
  moved one direction all session very commonly has `high === open` or `low === open`
  exactly, and a strict `< 0`/`> 0` would wrongly exclude that equality case. "Open" here is
  whichever the **Open Ref** toggle currently has selected (9:15 raw print or 9:18
  reference) — the quick filters read `highVsOpen`/`lowVsOpen`, which are already computed
  off `effectiveTicks`, so they inherit the override automatically with no extra wiring.

## Optimization

- **One grouped DuckDB query for all 209 symbols' percentile bands + SMA, not 209 round-trips
  or a Kite scan.** `get_percentile_bands()` computes both return-percentile series
  (intraday open→close and close-to-close) and SMA20/50/100/200 for the entire F&O universe
  in a single `GROUP BY symbol` query using DuckDB's `QUANTILE_CONT` aggregate — local
  Parquet/DuckDB aggregation, no `kite.historical_data()` calls at all, so it's fast even
  cold (~4s measured for 209 symbols) unlike the Kite-backed `/indicators` and
  `/reference-open` scans (~70s cold). Cached 1h server-side (`_PCTL_BANDS_CACHE`) since a
  5-year distribution barely shifts intraday. Fetched eagerly on page mount (`LiveScreenerPage`
  `useEffect`) rather than gated behind a scan button, since the cost profile doesn't demand it.
- **Both hero charts are pure client-side arithmetic over data already streaming — zero new
  backend series endpoints.** The index reuses the existing `/api/charts/reference-open`
  snapshot (see below); advance-decline reads `change_pct` straight off `/ws/charts` ticks,
  the same field already powering the Chg % column. Neither chart triggers a Kite call of
  its own.
- **5s client-side sampling, not one point per tick.** `useFoTicker` delivers a combined
  message ~once/sec; recording every single one would put ~22,500 points in each series
  over a full session for no visual benefit on a ~180px-tall hero tile. Both
  `EqualWeightIndexTile` and `AdvanceDeclineTile` throttle to one recorded point per 5s via
  a `useRef` timestamp guard, independent of React re-render cadence.
- **Intraday stats endpoint reuses `stock_metrics`'s existing day-cache decorator, not a new
  caching layer.** `get_intraday_stats()` is wrapped in the same `@_day_cached` (L1
  in-process dict → L2 Redis, 24h TTL, keyed by `(fn_name, today, symbol, years)`) every
  other `stock_metrics` function already uses — first expand of a symbol in a day computes
  the full 5-year query once; every later expand of that symbol (same day, any page) is a
  cache hit. No new infra, just reusing the existing decorator.
- **9:18 open reference reuses the 1D 1-minute candle cache, not a new Kite call shape.**
  `_reference_open_one()` reads the same `get_history(symbol, '1d', '1m')` series `ChartTile`
  and the indicator snapshot already populate and cache — it just scans forward to the first
  candle at/after the target minute and returns its open. A cold scan is still ~70s (one
  `historical_data` call per symbol, parallelized `ThreadPoolExecutor(max_workers=3)` like
  `get_indicators_snapshot`), but any symbol whose `(symbol, '1d', '1m')` cache entry is
  already warm (e.g. from a prior Charts-page RSI/ATR scan at tf=1d) costs nothing extra.
  120s server-side cache (`_REF_OPEN_CACHE`) since the reference barely moves once the
  session is well past the target minute.
- **One new backend endpoint value, no new routes.** The table itself reuses
  `GET /api/charts/symbols` and `/ws/charts` verbatim — every column is already present on
  `ChartsTick`. The 6-timeframe grid adds exactly one new `tf` value, `'yesterday'`, to the
  existing `GET /api/charts/history` (see Business Logic) — no new router, no new service.
- **No per-row chart mount cost unless expanded.** `MultiTimeframeGrid` for a row only
  mounts (and only then fires its 6 parallel `getHistory` calls / mounts 6 Highcharts
  instances) once that row's expand state is true — same lazy-cost principle as `/charts`'
  `useInView`, just gated by an explicit click instead of scroll proximity, since a plain
  table has no natural "about to scroll into view" signal per chart the way a tile grid does.
- **6 timeframes fetch in parallel, not serially.** `MultiTimeframeGrid` fires all 6
  `chartsApi.getHistory(symbol, tf)` calls in one `Promise.all` on mount/symbol-change, so
  expanding a row costs one round-trip latency, not six stacked ones. 5 of the 6 timeframes
  (yesterday/5d/1mo/3mo/1y) are cached server-side with TTLs already tuned for `/charts`
  (see `_HISTORY_TTL`/`_DEFAULT_TTL` in `fno_charts_service.py`); re-expanding the same
  symbol within that window is instant.
- **No virtualization.** The design-system guidance is to virtualize tables >100 rows; this
  table has ~209. Deferred for now — consistent with every other scanner table in this app
  (`/fno-momentum`, `/short`, `/delivery`) which also render their full row count without
  `react-window`, and the live tick updates (object identity change on `ticks`) make a
  virtualized window noticeably more work to keep correct alongside per-row expand state.
  Flagged as a fast-follow in Suggestions if scroll performance becomes an issue.

## Lessons Learnt

- **`Promise.all` across the 6 timeframe fetches made the whole grid wait for the single
  slowest one.** The original `MultiTimeframeGrid` fetched all 6 `getHistory` calls via
  `Promise.all(...).then(results => setHist(Object.fromEntries(results)))` — one state write,
  after every promise settled. A fast "Today" response (already warm in
  `fno_charts_service._history_cache`) sat invisible behind a slow cold "1 Year" fetch, so
  the whole expanded row looked frozen on "loading…" for however long the slowest of the 6
  took, then all 6 Highcharts instances mounted in one synchronous burst. Reported as "chart
  loading is slow, not smooth." Fixed by writing each tf's result to state **as that specific
  fetch resolves** (`setHist(prev => ({ ...prev, [tf]: r }))` inside each `.then()`, no
  `Promise.all`) — fast timeframes now render immediately, and the 6 mounts naturally spread
  across separate render passes instead of one big one. The `loading` boolean was removed
  entirely in favor of `hist[tf] === undefined` meaning "still loading" for that one card.
- **Row-click-to-expand needs `Record<symbol, boolean>`, not per-row `useState`.** Same
  rule as any `.map()`-rendered list with independent open/closed state (see CLAUDE.md
  Frontend lessons) — one `expanded` object in the page component, toggled with
  `setExpanded(prev => ({ ...prev, [symbol]: !prev[symbol] }))`, read per row as
  `expanded[r.symbol]`.
- **"Yesterday" has no clean fit in the existing 8-timeframe system.** `/charts`' `2d`
  timeframe is a rolling 2-trading-day window that includes *today's* partial session —
  there was no existing tf that meant "the prior completed session, and only that session."
  Added as a 9th backend tf (`fno_charts_service._prev_session_bounds`, mirroring the
  existing `_session_start` pattern but offset one trading day back, with a fixed `15:30`
  close bound since it's always a completed day) rather than overloading `2d` or trying to
  slice it client-side from a longer series.
- **New tf added to the type, deliberately kept out of the tab list.** `ChartsTf` gained
  `'yesterday'` (so `chartsApi.getHistory` and `TF_LABELS` stay exhaustively typed), but
  `CHARTS_TFS` — the array that drives `ChartTile`'s timeframe tabs and `CART_SECTIONS` —
  was left unchanged. Adding a type-level variant doesn't imply adding it everywhere that
  type is consumed; the 8 existing tabs on `/charts`/`/chart-cart`/`/clusters` are
  unaffected, and `'yesterday'` only appears via `MultiTimeframeGrid`'s own fixed list.
- **Hero charts verified against frozen weekend/after-hours data, not a live session.**
  Built and checked outside NSE trading hours (Sat), so `/ws/charts` ticks were a static
  snapshot from the last completed session rather than genuinely live — both tiles correctly
  rendered one accurate point each (index level + %-change, and ▲/▼/flat counts, both
  hand-verified against the underlying formulas) and then stopped adding new points, exactly
  as expected: `useMemo`-computed values that are bit-for-bit identical between renders
  don't retrigger a `useEffect` keyed on them, so frozen input correctly produces zero new
  samples rather than a flatline of duplicate points. This is the *correct* behavior for
  frozen data, not a bug — but it means the "draws dynamically over the day" behavior itself
  was never observed end-to-end and should be spot-checked once during a live session.
- **All comparisons are strict `<`/`>`, so "never below/above open" needs a hair of slack.**
  The filter engine has no `>=`/`<=` — every op is strict, by the same convention as
  `useLiveReturnFilters`/`useIndicatorFilters` elsewhere in this app. For a stock that opened
  and then only ever traded up, its day's low is very commonly *exactly* its open (the open
  print itself was the low), which means `Low vs Open % === 0` — a strict `> 0` filter
  excludes that case even though "low equals open" is clearly "never traded below open."
  Same issue mirrored for `High vs Open % === 0` under a strict `< 0` filter. Workaround:
  filter `> -0.01` / `< 0.01` instead of `> 0` / `< 0` so the equal case passes. Not worth
  adding a 4th inclusive-op pair to the toggle for this edge case; documented here instead.
- **Give-back % can read in the thousands of percent when the open-to-high range is tiny.**
  The formula's denominator is `high − open` — for a stock that barely ticked a few paise
  above its open before reversing hard, that denominator is near-zero, so even a small
  absolute move back below open produces a mathematically-correct but visually enormous
  percentage (e.g. 3000%+). Left as the raw ratio rather than capped/clamped, since the
  3-tier color (GREEN/AMBER/RED) already carries the actionable signal regardless of
  magnitude — a trader scanning the column cares that it's RED (mostly/fully reversed), not
  the exact four-digit number.

## Business Logic

- **Open-reference override works by swapping one field on the tick object, not by
  threading a second value through every formula.** `LiveScreenerPage` builds
  `effectiveTicks` — a copy of the live `/ws/charts` ticks with `open` replaced by the
  9:18 reference price (`refOpens[symbol]`) wherever one exists — and passes *that* into
  `toRow()`, `useScreenerFilters()`, and the expanded `MultiTimeframeGrid`. Every formula
  that reads `t.open` (`pctFrom`, `giveBackPct`, `recoveryPct`, and the filter engine's
  `vsOpen`/`lowVsOpen`/`highVsOpen`/`giveBack`/`recovery` cases) picks up the override for
  free, with zero changes to `chartsCommon.ts` or `useScreenerFilters.ts`. A symbol with no
  9:18 entry yet (session hasn't reached that minute) keeps its raw tick unchanged — the
  override is strictly additive, never produces a worse/missing value than 9:15 would.
- **Chg % is explicitly NOT affected.** It's `vs Yday Close` (`prev_close -> ltp`), which has
  nothing to do with today's open by definition — the toggle only touches fields that are
  mathematically open-relative.
- **`MultiTimeframeGrid`'s "Today" card is unaffected in practice**, even though it's handed
  `effectiveTicks` too (for consistency) — its own period-return math reads `tick.prev_close`
  and the 1-minute candle series' own first-candle open, never `tick.open` directly.
- **"vs OWN %ILE" return definitions are deliberately field-specific, not generic.** "vs Yday
  Close" compares against `closeToClose` daily returns `(close-prevClose)/prevClose*100` over
  the window — the same conceptual return as the Chg % column itself. "vs Today Open"
  compares against `intraday` daily returns `(close-open)/open*100` — the same definition as
  the expanded row's "5-Year Intraday Return %" table (`IntradayStatsTable` /
  `get_intraday_stats`). Two independently-maintained backend computations of overlapping
  math (`get_percentile_bands` bulk vs `get_intraday_stats` per-symbol) rather than one
  shared function — see Suggestions.
- **A percentile-mode condition can't false-exclude a symbol before its band has loaded.**
  `matchesCondition` returns `true` (passes, not fails) when `pctileThreshold == null` — so a
  trader who adds a "vs OWN %ILE" condition sees the full unfiltered table for the ~4s the
  `screener-stats` fetch is in flight, not an empty one, then it narrows once the snapshot
  lands. Same null-safety convention as every other field's "can't compute yet" case.

- Same F&O universe as `/charts` (`fno_charts_service.get_symbols()`, ~209 symbols from
  `marketdna-data/FO.csv`) — not the broader NSE 500.
- **Chg %** is the tick's own gap-inclusive `change_pct` (prev close → ltp), shown as `—`
  when `prev_close` hasn't arrived yet (pre-market/cold ticker).
- **From High/Low/Open %** are `(ltp − X) / X × 100` for `X ∈ {high, low, open}` — "From
  High %" is typically ≤ 0 (how far below the session high), "From Low %" typically ≥ 0
  (how far above the session low). All three go to `—` if the tick hasn't carried that
  field yet (same null-safety as `pctFrom` in `chartsCommon.ts`).
- **Dynamic filter combinator applies globally**, not per-condition — there is one AND/OR
  choice for the whole condition list, not per-pair boolean grouping (no parentheses/nesting).
  Sufficient for "all of these" or "any of these" screens; a mixed AND-of-ORs expression
  would need a future nested-group redesign (see Suggestions).
- **Between (`B/W`) is a single condition, not two conditions ANDed together** — it has its
  own `value2` field (`ScreenerCondition.value2`) rather than being sugar for two stacked
  `>`/`<` rows. This matters under **Match ANY (OR)**: a between-range condition OR'd with
  another condition only needs *that one range* to match, not both of its bounds
  independently — modeling it as two separate OR'd conditions would be wrong (either bound
  alone would satisfy an OR, not the intersection the range means).
- Null-valued cells (no tick yet, or a field the tick hasn't populated) sort to the bottom
  regardless of sort direction, so a symbol missing data never masquerades as a 0% move.
- **The 6 expanded-view timeframes and their return% baselines**
  (`fno_charts_service.get_history`, `MultiTimeframeGrid`):
  - **Today** (`tf='1d'`) — live, session-anchored from 09:15 (see `_session_start`).
    Return% is the tick's own gap-inclusive `change_pct` (prev close → ltp), and the chart's
    last point tracks the live tick, same as `ChartTile`'s 1D tab.
  - **Yesterday** (`tf='yesterday'`, new) — the single prior completed trading session,
    09:15–15:30 fixed bounds (`_prev_session_bounds`), `5minute` candles. Return% is that
    day's own first-candle-open → last-candle-close — there is no live tick involved, it's
    a closed window.
  - **5-Day / 1 Month / Quarterly / 1 Year** (`tf='5d'/'1mo'/'3mo'/'1y'`) — the same existing
    `/charts` timeframes, unchanged. Return% is first-candle-open → last-candle-close of
    each window, identical convention to `ChartTile`'s non-1D `periodPerf`.
  - All 6 fetch in parallel per expand and render **independently as each one resolves**
    (see Optimization — a fast timeframe shows its chart immediately rather than waiting for
    the slowest of the 6), each a real candlestick chart with the same visual language as
    `ChartTile` (red/green candles, tiny mono axis labels, prev-close dotted line on Today)
    — just without `ChartTile`'s tabs/resolution toggle/cart buttons, since each card is
    already locked to one timeframe.
- **5-year intraday return percentiles + moving averages, below the 6-timeframe grid.**
  `IntradayStatsTable` — a second fetch per expanded row, against `GET /api/stock/{symbol}/
  intraday-stats?years=5` (not `chartsApi` — this is a `stockApi` endpoint, since it's
  historical daily-bar analysis, not live-tick territory). Two small tables:
  - **5-Year Intraday Return %** — Min / 25th %ile / 50th %ile (Median) / 75th %ile / 90th
    %ile / Max of `(close-open)/open*100` across every trading day in the last 5 years
    (`n` trading days shown in the header). Each cell colored by sign (GREEN positive, RED
    negative) — not a bullish/bearish judgment, just the same sign convention as every other
    %-column on this page.
  - **Moving Averages** — latest SMA20/50/100/200 off the same 5-year close series, each
    colored GREEN when the live LTP is at/above that average and RED when below (an
    above/below-trend read, explicitly captioned "not a signal").

## Tech Stack

- Frontend: `src/pages/LiveScreenerPage.tsx` (table + hero), `src/components/charts/
  MultiTimeframeGrid.tsx` (the 6-panel expanded view — `SCREENER_TFS` list, `MiniTfCard`
  per timeframe), `src/components/charts/EqualWeightIndexTile.tsx` +
  `AdvanceDeclineTile.tsx` (the two hero charts — see What It Does; each owns its own
  client-side time-series `useState` + 5s-throttle `useRef`, no shared hook between them
  since their inputs/formulas differ enough not to be worth unifying),
  `src/components/charts/IntradayStatsTable.tsx` (the percentile/SMA table under the
  6-timeframe grid — its own `stockApi.getIntradayStats()` fetch per expand, independent of
  `MultiTimeframeGrid`'s fetches). Types in `src/types/stock.ts`
  (`IntradayStatsResponse`/`IntradayPercentiles`/`SMASnapshot`), client in
  `src/api/stockApi.ts` (`getIntradayStats`) — this is the `stockApi`/`/api/stock` surface,
  not `chartsApi`/`/api/charts`, since it's historical daily-bar analysis rather than
  live-tick territory.
- Reused from `/charts`: `src/hooks/useFoTicker.ts`, `src/components/charts/chartsCommon.ts`
  (`pct`, `pctFrom`, `matchesFilter`, `GREEN`/`RED`/`MONO`/`SANS`/`TF_LABELS`),
  `src/components/charts/FilterControls.tsx` (`OpToggle`), `src/api/chartsApi.ts`,
  `src/types/charts.ts` (`ChartsTf` extended with `'yesterday'`, kept out of `CHARTS_TFS`).
- New for this page: `src/hooks/useScreenerFilters.ts` (dynamic AND/OR condition list —
  `conditions` typed `ScreenerCondition{id,field,op,value,value2,pctileMode}`, `ScreenerOp =
  '<' | '>' | 'between'`, `PercentileKey = 'min'|'p25'|'p50'|'p75'|'p90'|'max'`,
  `pctileBandFor(field)` (which of `intraday`/`closeToClose` a field maps to, or `null` if
  it has no percentile mode), `combinator`,
  `addCondition`/`updateCondition`/`removeCondition`/`clear`, `toggleQuickFilter(field, op,
  value)`/`hasQuickFilter(field, op, value)` (add/remove one exact preset condition in one
  click, toggling on a field+op+value match), `active`, `passes(symbol, stats?)`, local
  `matchesCondition`/`isConditionActive` -- deliberately not the shared
  `chartsCommon.matchesFilter`, which only knows `'<'`/`'>'`),
  `src/components/charts/ScreenerFilterBar.tsx` (the condition-row UI, including the local
  `ScreenerOpToggle` 3-way `<`/`>`/`B/W` control with an `allowBetween` prop (`false` in
  percentile mode), the second "...and..." value box shown only for `between`, the "vs OWN
  %ILE" toggle shown only when `pctileBandFor(field)` is non-null, and the percentile-key
  `Select` that replaces the numeric input in that mode), `chartsCommon.giveBackPct()`/
  `recoveryPct()` (the two mirrored session-shape formulas — both power a table column *and*
  a filter field) + `AMBER` constant (the 3-tier Give-back %/Recovery % color scale is the
  first use of amber as a
  sortable-column color in this app). `lowVsOpen`/`highVsOpen` reuse the existing
  `pctFrom()` helper directly and are filter-only (no table column) — no new chartsCommon
  function needed for either.
- Backend: `app/services/fno_charts_service.py` — `_prev_session_bounds()`, `YESTERDAY_TF`
  added to `ALL_TFS` and branched in `get_history()` (reuses `GET /api/charts/history?
  tf=yesterday`, no new router); `_reference_open_one()`/`get_reference_open_snapshot()` +
  `_REF_OPEN_CACHE` for the 9:18 open-reference bulk scan, exposed via the new
  `GET /api/charts/reference-open?minute=HH:MM` route in `app/routers/charts.py`;
  `get_percentile_bands()` + `_PCTL_BANDS_CACHE` (new — the single grouped
  `QUANTILE_CONT`/SMA DuckDB query, see Optimization), exposed via
  `GET /api/charts/screener-stats?years=` in the same router. `app/services/
  stock_metrics.py` — `get_intraday_stats()` (new, `@_day_cached`), exposed via
  `GET /api/stock/{symbol}/intraday-stats?years=` in `app/routers/stock.py`; new models
  `IntradayStatsResponse`/`IntradayPercentiles`/`SMASnapshot` in `app/models/stock.py`.
- Standard `usePalette`/`useTokens` design tokens (`TH`/`TD`/`CARD`/`INPUT_SX`), MUI `Table`,
  Highcharts (`highcharts/highstock` + `highcharts-react-official`, `constructorType=
  "stockChart"`, same candlestick-tile treatment as `ChartTile` — see `MultiTimeframeGrid`
  in What It Does).
- `chartsApi.getReferenceOpen(minute)` / `ChartsReferenceOpenResponse` for the 9:18 bulk
  snapshot, `chartsApi.getScreenerStats(years)` / `ChartsScreenerStatsResponse` +
  `ScreenerSymbolStats` / `ReturnPercentileBand` for the percentile-bands + SMA bulk
  snapshot (all in `src/types/charts.ts`).

## Suggestions

- **"vs OWN %ILE" has no nested-group/between support, and only covers 2 of 12 fields.**
  Percentile mode is `<`/`>` against one breakpoint only (no "between 25th and 75th %ile" in
  one condition — needs two stacked conditions today), and only `vsPrevClose`/`vsOpen` have a
  precomputed band. Give-back %/Recovery %/vs-High/Low have no clean "5-year distribution of
  this exact derived metric" to bind to without a redesign of `get_percentile_bands()`.
- **Two independent backend computations of overlapping return math** — `get_percentile_bands`
  (bulk, all symbols, `fno_charts_service.py`) and `get_intraday_stats` (per-symbol,
  `stock_metrics.py`) both compute an intraday open→close percentile distribution from the
  same `equities_prices` data, just shaped differently (grouped bulk query vs. per-symbol
  with SMA). Not wrong today (different call sites, different cost profiles), but if a third
  consumer needs this shape, worth factoring into one shared DuckDB query builder.
- Combinator is global AND/OR only — no nested groups (e.g. `(A OR B) AND C`). If traders
  need compound logic, model conditions as a tree instead of a flat list + single combinator.
- No persistence for the filter set (resets on reload) — could follow the cart's
  `localStorage` pattern to save/name a screen (same idea flagged in `charts_page.md`).
- No CSV/PDF export of the sorted/filtered table, unlike `/fno-momentum`'s PDF buttons —
  worth adding if this becomes a daily pre-market routine.
- Consider a true virtualized table (`react-window`) if the full 209-row render becomes
  noticeably slow on lower-end devices, especially with several rows expanded at once.
- Could add the RSI/ATR%/Returns% bulk indicator snapshot (`/api/charts/indicators`,
  already built for `/charts`) as extra sortable/filterable columns here, reusing
  `useIndicatorFilters` alongside the new dynamic live filter.
- The 6-panel grid has no add-to-cart/bookmark action, unlike `ChartTile` — if a trader
  wants to save a setup discovered from the expanded view, they'd need to go find it on
  `/charts` instead. Could wire `useChartsCart` into `MiniTfCard` if that's wanted.
- **Open reference is a fixed 9:15-vs-9:18 toggle** (`OPEN_REF_MINUTE = '09:18'` constant in
  `LiveScreenerPage.tsx`), even though the backend endpoint already takes an arbitrary
  `minute` param. A trader wanting 9:20 or 9:30 instead currently can't from the UI. Could
  become a small number input next to the toggle if other reference minutes prove useful.
- **Hero charts don't backfill from 9:18/market-open** — they only draw forward from
  whenever the page is opened, so a trader loading the page at 11am sees a chart that starts
  at 11am, not one showing the full morning's shape. Backfilling would mean fetching 1-minute
  history for all ~209 symbols (same cost shape as the 9:18 reference scan) and computing the
  historical series client- or server-side before the live tail picks up — worth adding if
  "what has the index done all day" matters more than "what is it doing right now."
- **Hero chart series reset on reload/navigation** — no persistence, same as every other
  piece of transient page state here (sort, expand, filters). A trader who refreshes mid-day
  loses the index/breadth shape built up so far (and, per the point above, can't get it back
  without a backfill).
- **Advance-decline plots raw counts, not a classic cumulative A-D line** (which sums the
  period-over-period *change* in net advances across many bars/sessions). For a single
  intraday session, raw ▲/▼ counts over time is arguably more legible than a cumulative
  line — but if a trader specifically wants the textbook A-D Line, that's a different
  (cumulative) transform of the same two counts.
