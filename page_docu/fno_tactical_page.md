# F&O Tactical Page — `/fno-tactical`

Live intraday F&O decision dashboard. Its single job: surface **trend-aligned pullback entries** —
buy dips in monthly uptrends, sell rallies in monthly downtrends — and confirm each with OI
positioning and, on demand, the live option chain. Implemented from the `fno.md` skill.

## What It Does

Four stacked filters, one screen, refreshing every 5 seconds while the market is `LIVE`:

- **Zone 0 — Breadth gate.** Market-wide verdict `RISK_ON | RISK_OFF | NEUTRAL` from `% above VWAP`,
  advance/decline ratio, and Nifty's return since 9:15. Gates whether longs / shorts are enabled at all.
- **Zone 1 — OI positioning scatter.** X = intraday return from 9:15, Y = risk-adjusted move (ATRs
  travelled), bubble size = |OI change %|, colour = positioning quadrant
  (`LONG_BUILDUP / SHORT_COVERING / SHORT_BUILDUP / LONG_UNWINDING`). Shaded band beyond ±1.5 ATR = extended
  (pullback spent). Click a bubble → Zone 3.
- **Zone 2 — Normalized 9:15 lines.** Watchlist symbols + Nifty proxy + sector, all rebased to 0% at 9:15,
  for the relative-strength / V vs inverted-V timing read.
- **Zone 3 — Option-chain drilldown.** ATM ±3 strike ladder + three dual-axis charts (Future / Call / Put
  price-vs-OI). Opens on bubble click; polls every 5s while open and torn down on close.
- **Graded Signals table.** Server-side `grade()` output — only trend-aligned, gate-approved, non-extended
  setups with aligned relative-strength + VWAP side. A-grade = fresh conviction (OI rising your way);
  B-grade = other side capitulating (half size). When the stack produces nothing, that *is* the signal.
- **AI Trading Desk.** Tool-use chat over the live dashboard data — market state, breadth verdict, graded
  signals/top movers, per-symbol option chain, a single-aggregate stat tool (mean/std dev/z-score/
  annualized vol via NumPy), a general-purpose composable series tool (pick a source field, optionally a
  rolling transform or a cross-symbol comparison — correlation/beta/ratio/diff — then choose series/
  latest/summary output; covers "show me the last N days of X", "rolling volatility over time",
  "correlation with symbol Y" without needing a new narrow tool per question shape), TA-Lib indicators
  (RSI/SMA/EMA/ATR/ADX/MACD/BBANDS/STOCH), VectorBT backtests of whitelisted strategy templates (SMA
  crossover, RSI mean-reversion, Bollinger breakout — win rate/Sharpe/max drawdown/trade count), and a
  read-only Kite live-quote reader. Same architecture as the stock page's AI Research Assistant (LLM
  never invents a number, always calls a tool first). Every tool — including the composable series tool
  and the backtests — is a typed, parameterized function; the LLM never supplies code, a SQL string, or a
  formula, and no Kite order-placement is exposed anywhere. Routed through a third-party proxy instead of
  the official Anthropic API — see Tech Stack below.

## Optimization

- **5s frontend polling + in-process micro-cache**, not APScheduler/WebSocket (the skill's transport). One
  lock-guarded `_get_scan()` (keyed by a 4s time-slot) coalesces concurrent polls onto a single Kite pass —
  `_get_quotes` (≤500-instrument chunks) + one batched futures-OI `quote()`. Reuses the entire proven live
  substrate in `live_trading_service` (`_get_hist`, `_get_quotes`, `_iday`, NFO cache, `get_stock_options`,
  `get_strike_chart_data`) — no duplicated Kite plumbing.
- **DuckDB EOD fallback** when the market is closed: quotes and quadrant come from the settled parquet frame
  (`futures_chain` OI + `equities_prices` closes) so the page is useful for planning tomorrow's trades.
- Zone 3 option-chain endpoints are hit **only while a panel is open** — never poll every stock's chain.
- Static per-symbol context (ATR, DMAs, prev-close OI) comes from the daily-cached `_get_hist()` /
  `_get_fut_meta()`; the 5s loop only refreshes live price + OI.

## Lessons Learnt

- **The skill prescribed APScheduler + a Kite WebSocket ticker; this codebase has neither.** Every existing
  live page (`live_trading`, `intraday_race`, `sector_heatmap`) uses frontend 5s polling + lock-guarded
  time-slot caches + a DuckDB EOD fallback. We followed that convention. The *logic* (fields, quadrants,
  grades, market-state machine) follows the skill exactly; only the transport differs.
- **Kite intraday OI steps; price streams.** Every OI series renders as a step-line (`step: 'left'`), never
  interpolated, so the user doesn't read false precision into OI. This is a vendor characteristic, not a bug.
- **Live OI is the one net-new Kite surface.** If futures-OI resolution fails, quadrant / grade degrade
  gracefully (row keeps its price/ATR position, quadrant = null) — no hard failure.
- **Never render a frame without the state pill + session date.** A frozen scatter that looks live is the
  worst failure mode; the `StatePill` + `is_live` gate make "not live" impossible to miss, and the 5s poller
  only runs while `state === 'LIVE'`.
- Market state is resolved from the **NSE trading calendar** (`_NSE_HOLIDAYS` + weekday), never the clock
  alone — refresh the holiday set annually from the NSE circular.
- **aicredits.in is OpenAI-compatible, not Anthropic-Messages-API-compatible** — confirmed against their
  docs (`chat/completions`, `choices`/`tool_calls`, `Authorization: Bearer`). Despite serving a Claude model,
  the backend must use the `openai` SDK (pointed at `AICREDIT_BASE_URL`) with OpenAI-shaped
  `{"type": "function", "function": {...}}` tool definitions — the `anthropic` SDK's `input_schema` shape and
  `x-api-key` header will not work against this proxy. If the proxy is ever swapped for the official Anthropic
  API, switch back to the `anthropic` SDK and Anthropic's native tool/content-block shapes; don't just change
  the base URL.

## Business Logic

- **Monthly trend (non-repainting):** `UP` if `ltp>dma50 & dma20>dma50 & slope50>0`; `DOWN` if the mirror;
  else `NONE` → excluded from both lists. `dma20/dma50 = sma20/sma50`; `slope50` = 50-DMA now minus 50-DMA
  5 sessions ago.
- **Quadrant** = `sign(ltp − prev_close) × sign(oi − oi_prev_close)`.
- **Breadth verdict:** RISK-ON if `%aboveVWAP>60 & nifty_9:15>0 & adv/decl>1.5`; RISK-OFF is the mirror.
- **Grade (`strategy.md` table):** long only in `UP`+gate-not-RISK_OFF, on `LONG_BUILDUP` (A) / `SHORT_COVERING`
  (B); short is the mirror. Suppressed by: no trend · gate against · first ~50 min (time-of-day) · extended
  (|ret/ATR|>1.5) · rel-strength wrong side · VWAP wrong side. Size = full only for A-grade with an aligned
  gate; half otherwise or in NEUTRAL.

## Tech Stack

- **Backend:** `app/routers/fno.py` (`/api/fno/*`) · `app/services/fno_tactical_service.py` ·
  `app/models/fno.py`. Reuses `live_trading_service` + `kite_client` + `duckdb_client` (`futures_chain`).
- **Frontend:** `src/pages/FnoTacticalPage.tsx` · `src/api/fnoApi.ts` · `src/types/fno.ts`. Highcharts
  (scatter + line + dual-axis), design-system tokens via `usePalette()` / `useTokens()`.
- **AI Desk:** `app/services/fno_assistant.py` — 9 tools: `market_state`, `breadth`, `universe_summary`,
  `optionchain`, `quant_calc` (single aggregate stat via NumPy), `series_calc` (general-purpose composable
  tool — source field -> optional rolling transform or cross-symbol compare -> series/latest/summary
  output; reuses `equities_prices` via `duckdb_client`), `ta_indicator` (TA-Lib), `backtest` (VectorBT
  strategy templates), `live_quote` (read-only, reuses `live_trading_service._get_hist` / `_get_quotes` —
  no order-placement methods called anywhere) · `POST /api/fno/chat`. Uses the `openai` SDK against
  `AICREDIT_BASE_URL` (default `https://api.aicredits.in/v1`), model from `AICREDIT_MODEL` (default
  `claude-sonnet-5`). Config in `marketdna-backend/.env` (`AICREDIT_API_KEY` / `AICREDIT_BASE_URL` /
  `AICREDIT_MODEL`) — blank key returns a clean config error, no crash. Every tool is a narrow, typed,
  parameterized function — the LLM never supplies code, SQL, or a math expression for this desk
  (deliberately, to keep the same safety profile as every other tool in the app, even the general-purpose
  `series_calc`). No Kite order-placement is exposed, and won't be — MarketDNA's mission is explicitly not
  a trading bot.
- **Security note:** hardened the pre-existing `query_raw_data` tool (`mcp_server/tool_handlers.py`, used
  by the stock-page AI Research Assistant) while adding this — it previously ran any SQL string the LLM
  produced with no guard, including `COPY`/`ATTACH`/`PRAGMA`. Now rejects anything but a single, plain
  `SELECT` (`_sql_guard_error`).
- **Tests:** `tests/test_fno_tactical_service.py` — market-state boundaries, quadrant truth table, trend,
  breadth, grade (24 cases).

## Suggestions

1. **Watchlist control for Zone 2** — let the user pin symbols to the normalized-lines chart instead of the
   auto top-8 graded/movers default.
2. **Signal history / journal** — persist fired A/B grades per session to a derived parquet for later
   win-rate validation (currently live-only, nothing is stored).
3. **WebSocket focus stream** — if a Kite WS ticker is ever added platform-wide, move Zone 3 off REST polling
   onto it (the skill's original design) to cut latency and REST budget.
4. **EOD settlement job** — a ~15:40 job to snapshot the settled `CLOSED` frame (official close + settled OI)
   rather than the last live tick, for cleaner next-day planning.
5. **Lot-size table refresh** — `_LOT_SIZES` in `live_trading_service` is partial/quarterly; source it from
   the NFO instruments dump instead.
