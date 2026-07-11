# `/portfolios` — PortfoliosPage + PortfolioDetailPage (Quant Portfolios)

## Routing (updated)
- `/portfolios` — **Your Portfolios** (custom, if any) + **Discover grid** (10 built-ins).
  Built-in cards `<Link>` to `/portfolios/:key?universe=…`; custom cards show a CUSTOM
  badge + EDIT/DELETE. Hero has a **＋ Create Portfolio** CTA. Universe toggle sets the query param.
- `/portfolios/new` and `/portfolios/edit/:key` — **PortfolioBuilderPage** (custom rule builder).
- `/portfolios/:key` — **PortfolioDetailPage**. Each screen is an individual,
  forward-tracked paper portfolio with its own page.

## Custom (user-defined) portfolios
Users can create paper portfolios from **handwritten rules** (inception 10 Jul 2026, same
₹100 tracker as built-ins). A custom portfolio is a `PortfolioSpec` JSON at
`data_lake/derived/portfolios/custom/{key}.json`, resolved by key exactly like a built-in
via `portfolios_service.get_portfolio`. Config: entry rule, `rank_by` (score), weight scheme
(equal/score/inverse_vol/by_field), eviction/stop-loss rule + eviction weight
(redistribute/hold_cash), rebalance freq (W/M/Q) + optional rebalance rule + rebalance weight,
max_holdings.
- **Rule engine** (`portfolios_rules.py`): handwritten expressions parsed by a strict `ast`
  whitelist — comparisons, `and/or/not`, arithmetic `+ - * /` between known fields & numeric
  literals; **no** calls/attributes/eval. `z20 = (close-sma20)/std20` etc. pre-computed in
  `build_features`. Position fields `since_entry_pct`/`days_held` allowed only in eviction rules.
- **Tracker** (`portfolios_tracker_service.py`): per-holding weights in `_make_basis_rows`;
  daily eviction/stop-loss step (`_eviction_mask`→`_evict`) re-baselines to keep NAV continuous;
  `hold_cash` parks freed weight in a `$CASH` sleeve (ratio 1). `_rebalance_period` handles quarterly.
- **API**: `GET /custom/fields`, `GET /custom/{key}/spec`, `POST /custom` (422 on bad rule,
  409 on key collision), `PUT /custom/{key}`, `DELETE /custom/{key}` (purges tracker history).
- **Frontend**: `PortfolioBuilderPage.tsx` (rule textareas + weight selects + click-to-insert
  field catalog). Built at 2026-07 (all 4 phases). Tests: `tests/test_portfolios_rules.py`.

## Forward tracker (paper-portfolio engine)
Each portfolio is constituted at **inception 10 Jul 2026** with the current screen
holdings and their entry closes; ₹100 is notionally invested. From then on one NAV
point is appended per trading day, so the growth-of-₹100 curve is a true FORWARD live
track record (not a backtest). Backed by `portfolios_tracker_service` + three parquet
files under `data_lake/derived/portfolios/` (`basis`, `nav`, `rebalances`). On each
rebalance date the basket is re-screened, the add/drop diff is logged with rationale,
and NAV continuity is preserved (new entry closes, same running NAV). The detail page
shows: forward equity curve (inception-marked), live basket ticker, holdings table with
1D/5D/1M/3M/6M/1Y returns + **in-universe percentile ranks** per horizon, and the
rebalance log. Endpoint: `GET /api/portfolios/track/{key}?universe=` (NOT cached — it
appends NAV and recomputes ranks each call). `settings.data_path` resolves the data lake.

## What It Does
OHLCV-only "smallcase for traders". Presents 10 quant baskets generated purely from
price/volume — Strong Trend, Quiet Breakout, Momentum Leaders, Relative Strength,
Recovery, Volatility Expansion, Mean Reversion, Trend Quality, Sector Rotation,
Low Risk Compounders. A Discover grid lists every portfolio; selecting one loads its
current holdings, each with a 0–100 score and an expandable per-criterion
explainability panel (why the stock qualified). A "Run Backtest" action loads
walk-forward performance (CAGR, alpha, Sharpe, Sortino, max DD, hit rate) with a
growth-of-₹100 sparkline vs an equal-weighted benchmark.

**Universe selector**: a hero toggle lets the user screen either the **Nifty 200** or
**Nifty 500** constituents (default Nifty 500). Changing the universe re-screens the
active portfolio and re-benchmarks it against that universe's equal-weighted proxy.

**Live overlay (Phase 2)**: while the market is LIVE, the page polls
`GET /api/portfolios/live/{key}` every 5s and shows a basket ticker (equal-weighted
mark-to-market vs previous close, advancers/decliners) plus a per-holding live return
on each row. Holdings are fixed between rebalances; only the P&L ticks. When the market
is CLOSED/holiday the first poll returns `is_live=false`, polling stops, and the
last-session basket move stays on screen. Quotes come from `live_trading_service._quotes`
(Kite) with a DuckDB last-two-closes fallback; market state reuses
`fno_tactical_service.resolve_market_state()`.

## Optimization
- List loads on mount; the first portfolio auto-selects so the page is never empty.
- Screens are day-cached in the backend (`portfolios_service._day_cached`); the cache
  key includes the universe, so nifty200 and nifty500 cache independently. Repeat
  views are instant until `POST /api/portfolios/invalidate`.
- **`build_features()` and the tracker's `_returns_table()` are day-cached too.** These
  are the two heavy shared computations — the ~10s panel window query and the ~7s
  full-history trailing-returns scan. Before caching, every portfolio's screen/track
  recomputed both from scratch (15-20s per portfolio). Now the first request per day
  pays once and every other portfolio is a cache hit. Both share `_cache` and are
  cleared by `/api/portfolios/invalidate`. Callers treat the returned frames read-only.
- **Startup prewarm** (`portfolios_service.start_prewarm`) runs in `main.py`'s
  background prewarm thread, right after cointegration (before the ~3min screener
  prewarm). It warms `build_features` + all 9 screens + `_returns_table` so even the
  first user page load is ~2s, not 15-20s. Track over HTTP is now ~1.6-2.5s per portfolio.
- Universe membership + company names load once from the NSE constituent CSVs
  (`ind_nifty200list.csv` / `ind_nifty500list.csv`) via `functools.lru_cache`.
- Backtest is gated behind an explicit button (it rebuilds features per rebalance and
  is the one slow path). Default frequency is monthly; weekly is available via the API.
- Equity curve rendered as a lightweight inline SVG (no Highcharts dependency).

## Lessons Learnt
- Empty baskets are valid, not errors — strict screens (vol_expansion, quiet_breakout)
  legitimately return nothing in calm markets. The UI states this explicitly, naming
  the active universe.
- Relative strength uses an equal-weighted **universe** average as the NIFTY proxy;
  because the panel SQL is filtered to the chosen universe before the benchmark CTE,
  a Nifty 200 basket is measured against the Nifty 200 proxy. RS features are
  ratio/slope based so proxy price-scale cancels out.
- Company names come from the constituent CSV `Company Name` column; if the CSV is
  missing the service degrades to the full `equities_prices` view and hides names.
- The universe filter embeds a `symbol IN (...)` list into the panel SQL. NSE symbols
  are alphanumeric plus `&`/`-` (no quotes), and single quotes are escaped defensively.

## Business Logic
- Every portfolio = FILTER (hard rules) → SCORE (0–100, mostly cross-sectional ranks)
  → EXPLAIN (pass/fail criteria with values). Definitions live in
  `app/services/portfolios_service.py::PORTFOLIOS`.
- Universe = `nifty200 | nifty500` threaded through `build_features(asof, universe)`,
  `get_screen(key, size, universe)`, `get_backtest(..., universe)`, and `_price_panel(universe)`.
  Basket **size** stays at each portfolio's tuned default regardless of universe.
- Backtest is strictly walk-forward: features are rebuilt AS OF each rebalance date
  with `CAST(date AS DATE) <= asof`, so there is no look-ahead. A 25 bps per-rebalance
  round-trip cost is deducted. Growth is expressed as ₹100 invested at the start.
- Benchmark for alpha = equal-weight mean return across the selected universe each period.

## Tech Stack
- React + MUI, `usePalette()`/`useTokens()`, IBM Plex Sans/Mono, theme-aware hero.
- `Navbar` (Discover / Portfolio anchors) + shared `Footer` + `SectionHead`.
- API: `portfoliosApi.list()`, `.getScreen(key, universe)`, `.getBacktest(key, universe, freq)`, `.getLive(key, universe)`, `.invalidate()`.
- Live endpoint is NOT day-cached (must return fresh quotes each poll); everything else is day-cached.
- Backend: `/api/portfolios/*` (router → `portfolios_service` → DuckDB `equities_prices`),
  universe/name source from `marketdna-data/ind_nifty{200,500}list.csv`.

## Suggestions
- Persist backtest results to `data_lake/derived/portfolios/` and precompute nightly
  so weekly backtests are instant (mirror the stock_health parquet-first pattern).
- Add a size selector (Top 10/20/50) — the endpoint already accepts `?size=N`.
- Add rolling-alpha and monthly-heatmap visuals (data already in the backtest payload).
