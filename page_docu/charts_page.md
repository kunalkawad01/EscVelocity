# Live Charts Page — `/charts`

A 3-column grid of square candlestick tiles covering the full F&O underlying universe
(~209 symbols), each switchable across 8 timeframes (1D–5Y), with a searchable symbol
filter, a single shared live WebSocket feed, and a persistent "chart cart" for bookmarking
bullish/bearish setups by timeframe.

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

## Business Logic

- **F&O universe, not NSE 500.** Symbol list is `marketdna-data/FO.csv` via
  `fno_tactical_service._FO_SYMBOLS` (same source as `/fno-tactical`) — underlying
  equities that have listed futures/options, not the broader NSE-500 universe used by
  `/dataviz` or `stock_metrics.get_universe()`.
  - 8 timeframes map to Kite intervals: 1d→minute/1day, 2d→5minute/2day, 5d→15minute/5day,
    1mo/3mo/1y/5y→day/N-day lookback, ytd→day from Jan 1 of the current year (not a fixed
    day-count, computed per request).
- **Live overlay is 1D-only by design**, not a limitation — EOD daily candles (1mo–5y)
  have nothing to tick live against until tomorrow's bar exists.
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

## Tech Stack

- Backend: `app/services/fno_charts_service.py` (symbol list, OHLCV history with TTL cache,
  token resolution, KiteTicker lifecycle), `app/routers/charts.py` (`GET /api/charts/symbols`,
  `GET /api/charts/history`, `WS /ws/charts` on a separate `ws_router` so the path has no
  `/api` prefix). Wired into `app/main.py`'s background prewarm (`start_ticker`, tagged
  `"fno charts ticker"`) and shutdown (`stop_ticker`).
- Frontend: `src/pages/ChartsPage.tsx` (hero, grid, cart drawer). The chart tile itself,
  the live-tick websocket hook, the lazy-mount hook, and the shared formatting constants
  are **not** local to this page anymore — they live in `src/components/charts/` and
  `src/hooks/` so `/chart-cart` can reuse them (see `page_docu/chart_cart_page.md`):
  - `src/components/charts/ChartTile.tsx` — the chart tile (symbol header, add-to-cart
    buttons, timeframe tabs, candlestick/line toggle, Highstock chart).
  - `src/components/charts/chartsCommon.ts` — `MONO`, `SANS`, `GREEN`, `RED`, `TF_LABELS`,
    `pct`, `CART_SECTIONS`.
  - `src/hooks/useFoTicker.ts`, `src/hooks/useInView.ts`.
  - `src/api/chartsApi.ts` (`getSymbols`, `getHistory`, `wsUrl`), `src/types/charts.ts`
    (`ChartsTf`, `CHARTS_TFS`, `ChartsTick`, `ChartsCandle`, `ChartsHistoryResponse`,
    `ChartsWsMessage`).
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
