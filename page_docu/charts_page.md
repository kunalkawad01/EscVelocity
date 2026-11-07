# Live Charts Page — `/charts`

A 3-column grid of square candlestick tiles covering the full F&O underlying universe
(~209 symbols), each switchable across 8 timeframes (1D–5Y), with a searchable symbol
filter, an RSI/ATR%/Returns% indicator filter bar, a single shared live WebSocket feed,
and a persistent "chart cart" for bookmarking bullish/bearish setups by timeframe.

## What It Does

- **Hero.** Eyebrow badge + pulsing LIVE/CONNECTING indicator for the websocket, headline,
  description, and a `SearchBox` that filters the grid client-side by substring match on
  symbol (case-insensitive), with an `N / 209 symbols` counter.
- **3-column tile grid.** One square card per F&O underlying (`Grid item xs=12 sm=6 md=4`).
  Each tile: symbol + live LTP/change% header, add-to-cart buttons, 8 timeframe tabs
  (1D/2D/5D/1M/3M/YTD/1Y/5Y), a candlestick/line toggle, and a Highstock chart filling the
  remaining square area.
- **Live overlay.** Only the 1D tab's last candle tracks the websocket tick (close=ltp,
  high/low extended to include it); every other timeframe is static EOD daily history that
  doesn't move intraday, so it's left alone rather than re-rendered on every tick.
- **Lazy-mounted charts.** A tile only fetches its history and mounts its Highcharts
  instance once it scrolls within 300px of the viewport (`IntersectionObserver`), then
  stays mounted. Mounting ~209 live candlestick instances simultaneously would be very
  heavy — see Optimization.
- **Candlestick/line toggle.** Small 2-button switch per tile (next to the timeframe tabs)
  swaps the series between Highcharts `candlestick` and a filled `area` line, independently
  per card.
- **1D candle resolution toggle (1M / 5M).** Shown only on the 1D tab, next to the
  candlestick/line toggle — lets a trader switch that tile's live chart between 1-minute
  and 5-minute candles. Independent per tile (two tiles can show different resolutions at
  once) and remembered per tile across tf tab switches (flipping to 2D and back to 1D keeps
  the last chosen resolution). Every other timeframe has one fixed interval and has no such
  control.
- **Previous-close reference line.** A dotted `yAxis` plot line at `tick.prev_close`,
  labeled "Prev Close", so a trader can see today's move against yesterday's close at a
  glance without reading the header number. Only drawn when a live tick exists for that
  symbol (absent pre-market / if the ticker hasn't delivered a tick yet).
- **Chart cart (e-commerce-style "add to cart").** Two small icons next to each tile's LTP
  — green ▲ (`TrendingUpIcon`) for bullish, red ▼ (`TrendingDownIcon`) for bearish — each
  independently toggle that (symbol, active timeframe, direction) into a persistent cart.
  Direction is the trader's own call, picked explicitly per click, never inferred from price
  action. The same symbol+timeframe can sit in both "1D Bullish" and "1D Bearish" at once if
  the trader wants to track both scenarios for the same chart. Each cart entry also carries
  descriptive price/change% context computed from *the selected timeframe's own move* (first
  candle's open vs. last close, or the live tick for 1D) — not the live daily `change_pct` —
  but that number is informational only and never decides which section an item lands in.
  A floating cart button (bottom-right, badge = total item count) opens a right-side MUI
  `Drawer` listing every non-empty section (e.g. "1D Bullish", "2D Bearish", …) with
  per-item remove, per-section "clear", a "CLEAR ALL", and an "OPEN FULL CART PAGE →"
  link to `/chart-cart` (see `page_docu/chart_cart_page.md`) for filtering/sorting/a
  flat-grid view across the whole cart.
- **Indicator filter bar (RSI / ATR% / Returns%).** A card below the hero with its own
  "Indicator TF" timeframe picker (independent of each tile's own tf tab) and three
  fields — RSI, ATR %, Returns % — each with a `<`/`>` operator toggle and a number box
  (e.g. "RSI > 70"). Any subset can be filled in; a blank field doesn't filter on that
  indicator. Clicking **Apply** (or **Re-scan** once a snapshot exists) fetches a bulk
  indicator snapshot for every F&O symbol at the chosen timeframe and narrows the grid
  to symbols passing all filled-in conditions — the `{filtered}/{total} symbols` counter
  updates accordingly, combined with the search box (both narrow the same list).
  Changing an operator or threshold after a snapshot exists re-filters instantly
  client-side, with no new network call — only a timeframe change or **Re-scan**
  re-fetches. A status line shows "Scanning…" while loading, then the snapshot
  timestamp once done.

## Optimization

- **One websocket for the whole grid.** `/ws/charts` pushes every tracked symbol's tick in
  one combined JSON message per second, from an in-process dict populated by a dedicated
  `KiteTicker` connection (`fno_charts_service.py`) — not a socket per tile. Mirrors the
  exact pattern already proven by `/ws/nifty50` (`nifty50_service.py` /
  `live_trading_service.start_ticker`), but on its **own** KiteTicker connection rather than
  multiplexing onto the NIFTY 50 one, since Zerodha allows multiple simultaneous ticker
  connections per app and 209 instruments is well within a single socket's limits.
- **Lazy mount, not virtualization.** Rather than a windowed list (which would fight the
  CSS grid + variable scroll-to-card math), each tile independently defers its REST fetch
  + Highcharts mount until it's about to be scrolled into view, and never tears down after
  — the design-system guidance to virtualize tables >100 rows doesn't translate cleanly to
  a grid of charts, so this is the equivalent cost-control for this page shape.
  (Fast-follow if scroll performance ever becomes an issue even with lazy mount: a true
  windowed grid.)
- **Intraday tiles (1D/2D/5D) poll `getHistory` on an interval matching the backend's own
  cache TTL** (15s/30s/60s) while mounted, instead of fetching once at mount and never
  again — see Lessons Learnt. Longer timeframes (1mo…5y) fetch once only; their candles are
  static EOD data that doesn't change intraday, so polling them would be pure waste.
- **Per-(symbol, tf) history cache, short TTL on intraday.** `fno_charts_service.get_history`
  caches each (symbol, tf) response; 1d/2d/5d get a 15–60s TTL (cheap to refresh, changes
  fast), 1mo/3mo/ytd/1y/5y get a 300s TTL (daily candles, barely move intraday) — same
  shape as `nifty50_service.TF_CONFIG`/`_HISTORY_CACHE_TTL`.
- **Batched instrument-token resolution.** All ~209 tokens are resolved via `kite.ltp()` in
  chunks of 200 rather than one call per symbol, both for the ticker's initial subscription
  list and for any ad-hoc `get_history()` lookup. Resolved tokens are cached module-wide
  (`_token_cache`) so repeat lookups are free.
- **Cart has zero backend cost.** It's pure client-side `localStorage` state — no API call,
  no DuckDB/Postgres read, no extra load on the server per add/remove/toggle.
- **Indicator snapshot is one bulk scan, cached per timeframe, not 209 client-side fetches.**
  `GET /api/charts/indicators?tf=` computes RSI/ATR%/Returns% for the whole F&O universe
  in one response and caches it (same TTL table as `get_history` — 15–60s for intraday
  tf, 300s for daily tf). A cold scan is slow (~30s observed for 209 symbols at 1D, since
  each symbol still needs its own `kite.historical_data()` call under the hood) — fetched
  with a `ThreadPoolExecutor(max_workers=3)` to parallelize those calls without exceeding
  Kite's ~3 req/s historical-data rate limit. Every (symbol, tf) history fetch inside the
  scan still hits the same `_history_cache` the chart tiles themselves populate, so a
  scan for a timeframe the user has already been browsing can be much faster than cold.
  This is why the filter bar gates the fetch behind an explicit Apply/Re-scan button
  instead of firing on every keystroke — same UX pattern as other slow scans in this app
  (`/quant-strategies`, `/pattern-dna`'s validation gate).

## Lessons Learnt

- **Caddy had no `/ws/*` passthrough.** `/ws/nifty50` and the new `/ws/charts` both live
  outside `/api/*`, and the production Caddyfile only had `handle` blocks for
  `/api/*`/`/docs*`/`/openapi.json` before the SPA fallback — so in production (not local
  dev, which rides Vite's proxy) a websocket connection would have fallen through to the
  static file server and 404'd into `index.html` instead of upgrading. Fixed by adding a
  `handle /ws/* { reverse_proxy backend:8000 }` block ahead of the SPA handler. This also
  retroactively fixes `/ws/nifty50` in production, which had the same latent gap.
- **`aspectRatio: '1/1'` + flex column + absolutely-positioned chart wrapper** is the
  pattern that makes Highcharts fill a responsive square tile. HighchartsReact needs a
  definite pixel height at mount; `containerProps={{ style: { height: '100%', width: '100%' } }}`
  on a `position: absolute; inset: 0` wrapper inside a `flex: 1; min-height: 0` parent
  resolves that from the square ancestor's own resolved height. A fixed `chart.height` in
  the options object would defeat the square-per-breakpoint responsiveness.
- **`docker compose exec` doesn't see the live server's in-process state.** Verifying the
  ticker during the initial VPS deploy by running `docker compose exec backend python -c
  "...get_ticks()..."` returned 0 ticks, looking like a dead ticker — but `exec` spawns a
  brand-new Python process that doesn't share the running uvicorn process's `_fo_ticks`
  dict. Fixed by opening a real WebSocket connection to the running server's own
  `/ws/charts` endpoint instead, which correctly showed live ticks flowing.
- **Direction must be a user choice, not a derived one.** The first cart implementation
  auto-computed bullish/bearish from the timeframe's own price move (`close >= open`),
  which meant a tile could only ever be added to whichever direction matched its current
  price action — there was no way to bookmark a stock as "I think this turns bearish" while
  it was still green. Replaced with two independent, always-available buttons (▲/▼) so the
  trader picks the direction themselves; see Business Logic.
- **1D "Returns" must be gap-inclusive (prev close → last), not open-of-day → last.**
  The first version of the Returns filter computed every timeframe's return the same way
  the cart's price/change% context does: first candle's open → last close. For 1D that
  meant "today's session open → now", which silently excludes overnight gap moves — a
  stock that gapped up 10% on news and then traded flat all session shows a ~0% open-to-
  close move despite a real +10% day. Reported as a bug (`Returns > 5` missing MARICO,
  which was actually +10%) and fixed: for `tf == '1d'` specifically, Returns now uses the
  live tick's `prev_close → ltp` (same number the tile header's change% and
  `ChartsTick.change_pct` already show). Every other timeframe (2D…5Y) still uses its own
  window's first-candle-open as the baseline — there's no single "previous close" that
  means anything for a 1-year window, so period-start-to-period-end remains correct there.
  See `_compute_indicators_one` in `fno_charts_service.py`.
- **1D history must start at today's 09:15 open, not "now minus 24 hours."** The original
  `get_history()` computed the 1D lookback as `to_dt - timedelta(days=1)` — a rolling 24h
  window, which bleeds into the tail end of the *previous* trading session's candles
  whenever `now` is before yesterday's exact clock time (e.g. checking the chart at 10:30am
  pulls candles back to 10:30am yesterday, well before today's 09:15 open). Reported as a
  bug (1D tile visibly starting with a chunk of the prior day). Fixed with `_session_start()`
  in `fno_charts_service.py`: resolves 09:15 of the most recently started session — today at
  09:15 if it's a weekday and that time has passed, else the most recent prior weekday —
  and uses that as `from_dt` for `tf == '1d'` specifically. Every other timeframe (2D…5Y)
  is unaffected; their rolling N-day lookbacks are correct by design since there's no single
  "session start" to anchor to.
- **A tile's history was only ever fetched once — new candles never appeared without a hard
  refresh.** `ChartTile`'s live overlay (see Business Logic) only mutates the *last* bar of
  whatever `hist.candles` array was fetched at mount; it never appends a new bar. Since the
  original fetch effect had no re-fetch of any kind, the x-axis was frozen at mount time
  forever — a trader watching the 1D tile all morning would see the live tick keep moving
  the same last candle's close, but a brand-new minute candle (as the session progressed)
  would never appear until the page was reloaded (which remounts `ChartTile`, forcing a
  fresh fetch against whatever history Kite now has). Reported as "need a hard refresh to
  see a new candle form." Fixed by polling `getHistory` on an interval for the 1D/2D/5D
  tabs specifically, matching the backend's own TTL per tf (see Optimization) — a new
  candle now appears on its own as the session progresses.
- **Highstock auto-groups points you didn't ask it to group.** After shipping the 1M/5M
  resolution toggle, both options visually looked identical — 1m's ~200+ points and 5m's
  ~40 points both rendered as the same handful of wide bars. Root cause: Highstock's
  candlestick/OHLC series has `dataGrouping` enabled by default, which re-buckets points to
  keep each visual bar above a minimum pixel width — in a small square tile that silently
  collapsed both resolutions down to roughly the same coarse grouping, making the toggle
  look broken even though the correct raw data (confirmed via network requests) was being
  fetched for each choice all along. The bug was in the chart options, not the fetch layer.
  Fixed with `dataGrouping: { enabled: false }` on both the candlestick and area series so
  the chart always plots the exact candles it was given.

## Business Logic

- **F&O universe, not NSE 500.** Symbol list is `marketdna-data/FO.csv` via
  `fno_tactical_service._FO_SYMBOLS` (same source as `/fno-tactical`) — underlying
  equities that have listed futures/options, not the broader NSE-500 universe used by
  `/dataviz` or `stock_metrics.get_universe()`.
  - 8 timeframes map to Kite intervals: 1d→minute/1day, 2d→5minute/2day, 5d→15minute/5day,
    1mo/3mo/1y/5y→day/N-day lookback, ytd→day from Jan 1 of the current year (not a fixed
    day-count, computed per request).
  - **1D's lookback is session-anchored, not a rolling 24h window.** `from_dt` for `tf=='1d'`
    is always 09:15 of the current (or, pre-market/weekend, most recent) trading day — so
    the 1D tile always shows exactly "today's candles so far," never a mix of today's and
    yesterday's bars. See Lessons Learnt.
- **Live overlay is 1D-only by design**, not a limitation — EOD daily candles (1mo–5y)
  have nothing to tick live against until tomorrow's bar exists.
- **1D resolution (1m/5m) is a display choice, not a separate timeframe.** It's an
  `interval` query param on the same `GET /api/charts/history?tf=1d` endpoint (`'1m'`→Kite
  `minute`, `'5m'`→Kite `5minute`), ignored server-side for every other `tf`. Cached as a
  distinct `(symbol, '1d', interval)` entry so switching resolution on one tile never
  evicts the other resolution's cached data — flipping back and forth doesn't re-hit Kite
  if both were already warm. The cart's `periodPerf` (open→close) and the live tick overlay
  (last bar's O/H/L/C) are unaffected by which resolution is selected — both operate on
  "whatever the last bar in `hist.candles` is," regardless of its width.
- **Cart is client-only, no backend endpoint.** It's a personal watchlist/trade-idea
  tracker scoped to one browser (`localStorage`, key `charts_cart_v1`), not shared data —
  consistent with every other piece of page state here (tf tab, chart type) being local
  component state. No Postgres table, no `/api/charts/cart` route.
- **Cart item identity is `(symbol, tf, direction)`**, not just `symbol` — the same stock
  can sit in "1D Bullish", "1D Bearish" and "2D Bearish" simultaneously as independent
  entries, since the trade idea a trader is bookmarking is timeframe- and direction-specific
  and direction is explicitly chosen, not derived from price.
- **Cart sections are keyed by the active timeframe at the moment of the click**, not a
  fixed property of the symbol — switching a tile's tab before clicking add-to-cart changes
  which section the new entry lands in (e.g. click 2D tab, then add bearish → files under
  "2D Bearish"). The tf tabs and the cart buttons share the same component state.
- **Cart's price/change% context reflects the timeframe's own candle range**, not the live
  daily `change_pct` shown in the tile header — so a "5D Bullish" entry shows the 5-day
  move, not today's intraday move, even though both numbers are visible on the same tile.
- **Indicator definitions.** RSI and ATR are Wilder's standard RSI(14)/ATR(14), identical
  formulas to `/indicators` (reused, not re-derived — see `indicators_service._rsi`/`_atr`).
  ATR is reported as **% of last close** (`atr_pct = atr / last_close * 100`), not raw
  price units, so a ₹50 stock and a ₹5,000 stock are directly comparable in one filter.
  Returns% is the period's own move — prev-close-based for 1D (see Lessons Learnt), and
  first-candle-open-to-last-close for every longer timeframe. All three are computed over
  the *same candle series the Indicator TF picker selects*, which is independent of
  whatever tf each individual tile happens to be showing.
- **A symbol with insufficient candle history (<15 bars) is dropped from the snapshot
  entirely**, not given a null/zero indicator value — so it simply won't appear in any
  Returns/RSI/ATR filter's passing set, same as if the filter excluded it. This mostly
  affects thin/newly-listed F&O symbols on longer timeframes.

## Tech Stack

- Backend: `app/services/fno_charts_service.py` (symbol list, OHLCV history with TTL cache
  keyed `(symbol, tf, interval)`, `ONE_D_INTERVALS` map for the 1D resolution toggle,
  `_session_start()`, token resolution, KiteTicker lifecycle,
  `get_indicators_snapshot`/`_compute_indicators_one` for RSI/ATR%/Returns%, reusing
  `indicators_service._rsi`/`_atr`), `app/routers/charts.py`
  (`GET /api/charts/symbols`, `GET /api/charts/history?symbol=&tf=&interval=`,
  `GET /api/charts/indicators`, `WS /ws/charts` on a separate `ws_router` so the path has
  no `/api` prefix). Wired into `app/main.py`'s background prewarm (`start_ticker`, tagged
  `"fno charts ticker"`) and shutdown (`stop_ticker`).
- Frontend: `src/pages/ChartsPage.tsx` (hero, grid, cart drawer). The chart tile itself,
  the live-tick websocket hook, the lazy-mount hook, and the shared formatting constants
  are **not** local to this page anymore — they live in `src/components/charts/` and
  `src/hooks/` so `/chart-cart` can reuse them (see `page_docu/chart_cart_page.md`):
  - `src/components/charts/ChartTile.tsx` — the chart tile (symbol header, add-to-cart
    buttons, timeframe tabs, candlestick/line toggle, 1D resolution toggle, Highstock
    chart).
  - `src/components/charts/chartsCommon.ts` — `MONO`, `SANS`, `GREEN`, `RED`, `TF_LABELS`,
    `pct`, `CART_SECTIONS`.
  - `src/components/charts/IndicatorFilterBar.tsx` — the RSI/ATR%/Returns% filter UI
    (Indicator TF pills, three `<`/`>` + value fields, Apply/Re-scan/Clear, status line).
  - `src/hooks/useFoTicker.ts`, `src/hooks/useInView.ts`, `src/hooks/useIndicatorFilters.ts`
    (filter state + snapshot fetch + `passes(symbol)` matcher — see Business Logic).
  - `src/api/chartsApi.ts` (`getSymbols`, `getHistory` — takes an optional
    `ChartsOneDInterval`, `getIndicators`, `wsUrl`), `src/types/charts.ts` (`ChartsTf`,
    `CHARTS_TFS`, `ChartsOneDInterval`, `ONE_D_INTERVALS`, `ChartsTick`, `ChartsCandle`,
    `ChartsHistoryResponse`, `ChartsWsMessage`, `ChartsIndicatorEntry`,
    `ChartsIndicatorsResponse`).
  Highcharts/Highstock via `highcharts-react-official` (`constructorType="stockChart"`),
  MUI `Grid`/`Drawer`, shared `src/components/shared/SearchBox.tsx`, standard
  `usePalette`/`useTokens` design tokens.
- Cart: `src/hooks/useChartsCart.ts` — `localStorage`-backed hook (`items`, `isInCart`,
  `toggle`, `remove`, `clearSection`, `clearAll`), consumed by `ChartsPage`'s floating
  `IconButton` + MUI `Drawer`, by each `ChartTile`'s two add-to-cart `IconButton`s
  (`TrendingUpIcon` / `TrendingDownIcon` from `@mui/icons-material`), and by the full
  `/chart-cart` page.

## Suggestions

- Sort/prioritize the grid (e.g. gainers first, or F&O OI-based ordering) instead of plain
  alphabetical — currently the grid order is `sorted(_FO_SYMBOLS)`.
- Consider a true windowed/virtualized grid if the lazy-mount pattern proves insufficient
  on lower-end devices scrolling through all ~209 tiles.
- Per-tile "pin to top" or a favorites filter, so a trader can keep a working set visible
  without the search box.
- Cart is `localStorage`-only today, so it doesn't follow the user across devices/browsers.
  If that's ever needed, migrate to the same Postgres pattern as `custom_portfolios`
  (`app/db.py`) rather than inventing a new store.
- A per-section "clear" click currently has no confirmation — fine for a lightweight
  watchlist, but worth a confirm step if the cart grows into something higher-stakes.
- No bulk action from the cart drawer yet (e.g. "open all 1D Bullish in Pattern DNA" or
  export to CSV) — today it's view/remove only.
- Indicator filter bar only offers RSI/ATR%/Returns% — MACD cross, volume ratio, or a
  distance-from-SMA filter would reuse the same bulk-snapshot pattern cheaply since
  `indicators_service` already has those formulas.
- No way to save/name a filter combination (e.g. "my oversold momentum screen") — every
  reload starts from blank filters. Could persist alongside the cart in `localStorage`.
- The indicator snapshot has no explicit "stale" indicator once its TTL has lapsed in the
  background — the status line always shows the original scan timestamp even after the
  underlying cache has silently refreshed on a later unrelated request. Worth surfacing
  "may be stale, Re-scan to refresh" once TTL has passed.
