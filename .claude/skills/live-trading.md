---
name: marketdna:sector-stock-intelligence
description: >
  Use this skill when the user asks to build, re-create, modify, or debug the live
  trading page, or asks about "sector scatter", "sector drill-down", "stock intelligence
  card", "breakthrough signals", "Why Now cards", "live market intelligence", or the
  "/live-trading" route. Also use when asking about Layer 1–4 architecture, the Kite
  live/EOD-fallback data mode, the _iday accumulator, or the /api/live/* endpoints.
metadata:
  version: "3.0.0"
  platform: MarketDNA
  route: /live-trading (NOT yet registered in App.tsx — must be added)
  backend_prefix: /api/live
  frontend_file: marketdna-web/src/pages/LiveTradingPage.tsx (~2401 lines)
  backend_router: marketdna-backend/app/routers/live_trading.py
  backend_service: marketdna-backend/app/services/live_trading_service.py
  backend_models: marketdna-backend/app/models/live_trading.py
  frontend_api: marketdna-web/src/api/liveApi.ts
  frontend_types: marketdna-web/src/types/live.ts
  refresh_cadence: 5 seconds (market hours only; scatter always)
  data_modes: live (Kite responds) | eod_fallback (DuckDB 3:30 PM close)
---

# MarketDNA — Sector & Stock Intelligence Terminal

## What the Page Does

A 4-layer live market intelligence terminal for NSE/BSE. Layers activate progressively
through user interaction. All data refreshes every 5 seconds during market hours
(Mon–Fri 9:15–15:30 IST). When Kite is offline, falls back to DuckDB EOD (3:30 PM close)
data automatically — page still renders meaningful data at all times.

**Route**: `/live-trading` — **not yet wired into `App.tsx`**. Must be added as a
`<Route path="/live-trading" element={<LiveTradingPage />} />`.

---

## Data Architecture

### Sector Universe (SECTOR_MAP in live_trading_service.py)

11 sectors, ~80 symbols total:

| Sector         | Example symbols                                      |
| -------------- | ---------------------------------------------------- |
| Banking        | HDFCBANK, ICICIBANK, SBIN, KOTAKBANK, AXISBANK (+4)  |
| Finance        | BAJFINANCE, BAJAJFINSV, CHOLAFIN, SBILIFE (+3)       |
| IT             | TCS, INFY, HCLTECH, WIPRO, TECHM (+4)               |
| Energy         | RELIANCE, ONGC, NTPC, BPCL, POWERGRID (+4)          |
| Auto           | MARUTI, TATAMOTORS, M&M, BAJAJ-AUTO (+4)            |
| Pharma         | SUNPHARMA, DRREDDY, CIPLA, DIVISLAB (+4)            |
| FMCG           | HINDUNILVR, ITC, NESTLE, BRITANNIA (+5)             |
| Metals         | TATASTEEL, HINDALCO, JSWSTEEL, VEDL (+4)            |
| Infrastructure | LT, ADANIPORTS, ULTRACEMCO, GRASIM (+5)             |
| Telecom        | BHARTIARTL, IDEA                                     |
| Consumer       | TITAN, ASIANPAINT, PIDILITIND, VOLTAS (+2)          |

### Historical Context Cache (`_hist`)

One DuckDB batch query at service startup (refreshes once per calendar day). Pulls for
all ~80 symbols in one `WHERE symbol IN (...)` query:

- `prev_close`, `prev_high`, `prev_low`, `today_open`, `today_volume`, `yesterday_close`
- `atr14` (14-bar ATR), `sma20`, `sma50`, `sma200`
- `high_52w`, `low_52w`, `avg_vol20`
- `peak_5d`, `peak_20d`, `peak_60d`, `peak_252d` (for drawdown)
- `atr_5d`, `atr_prior_20d` (for ATR compression detection)
- `high_10d`, `low_10d`, `high_10d_prior`, `low_10d_prior` (range for consolidation signals)
- `closes_60d` (last 60 daily closes, chronological)

### Intraday Accumulator (`_iday`)

In-process ring buffer: `{symbol: [(HH:MM, ltp)]}`, max 4800 entries per symbol (~6.5h
at 5s cadence). **Resets each calendar day.** Only populated when Kite returns a live
quote (`data_mode == "live"`). Used by Layer 2 progression charts, Layer 2 mini-chart
sparklines, and Layer 3 `sparkline_intraday`.

### Kite Quote Fetch (`_quotes`)

Calls `kite.quote(["NSE:SYM1", ...])` in chunks of 500. Returns `{sym: {ltp, open, high,
low, prev_close, vwap, volume}}`. On any exception, returns `{}` → triggers EOD fallback.

### EOD Fallback (`_fallback_quotes`)

When Kite is offline: synthesises quotes from `_hist` using `rn=1` close as LTP and
`rn=2` close as prev_close. This means the scatter and stock cards show **3:30 PM
end-of-day data** with meaningful sector return and ATR values. Badge: "EOD DATA — 3:30 PM CLOSE".

**Consolidation signal adjustment**: When `data_mode == "eod_fallback"`, signal engine
uses `high_10d_prior` / `low_10d_prior` (rn 2-11) instead of `high_10d` / `low_10d`
(rn 1-10) so today's closing price doesn't trivially block all breakout/breakdown signals.

### 15-min Kite Historical Bars

Used for Layer 1 sector progression and Layer 2 sector/stock progression when market
is closed. Calls `kite.ltp()` (to get instrument tokens) then `kite.historical_data(token,
from_dt, to_dt, "15minute")`. Result is:

- Layer 1 progressions: 2 rep symbols per sector, cached per trade date in `_all_prog_cache`.
- Layer 2 progressions + sparklines: all sector symbols (up to 8), returned per-request.
- Layer 3 `sparkline_intraday`: single symbol fetch.

Normalised to `0%` at the 9:15 AM open (first bar's `open` value = baseline).

---

## API Endpoints

All under prefix `/api/live`. No cache invalidation endpoints (data refreshes automatically).

| Method | Path                         | Handler                     | Notes                                    |
| ------ | ---------------------------- | --------------------------- | ---------------------------------------- |
| GET    | `/sectors`                   | `get_sector_scatter()`      | Layer 1 scatter; always refreshes        |
| GET    | `/sector-progressions`       | `get_sector_progressions()` | Layer 1 multi-line chart; live or 15min  |
| GET    | `/sector/{sector_name}`      | `get_sector_detail()`       | Layer 2; 404 if sector not in SECTOR_MAP |
| GET    | `/stock/{symbol}`            | `get_stock_intelligence()`  | Layer 3; 404 if symbol not in _hist      |
| GET    | `/signals`                   | `get_breakthrough_signals()`| Layer 4; up to 20 signals, sorted        |
| GET    | `/stock/{symbol}/chart`      | `get_stock_chart()`         | Layer 3 supplementary; 365-bar OHLCV + ranks_tf |

### Response Models (live_trading.py)

```python
SectorScatterResponse:   as_of, kite_live, data_mode, nifty_return, sectors: [SectorPoint]
SectorPoint:             sector, return_pct, atr_pct, stock_count, direction: "long"|"short"|"neutral"

SectorProgressionsResponse:  trade_date, source: "live"|"15min_kite"|"none",
                             progressions: {sector: [{time, return_pct}]}

SectorDrillDownResponse: sector, as_of, data_mode, return_pct, atr_pct, vs_nifty, short_bias,
                         current_correlation, constituents: [ConstituentPoint],
                         intraday_progression: [IntradayPoint], intraday_progression_source,
                         stock_progressions: {sym: [{time, return_pct}]} | None,
                         mini_charts: [MiniChart], correlation_history: [float], correlation_times: [str]
ConstituentPoint:        symbol, return_pct, atr_pct, ltp, direction
IntradayPoint:           time, sector_return, nifty_return
MiniChart:               symbol, return_pct, ltp, direction, sparkline: [float]

StockIntelligenceResponse: symbol, as_of, data_mode, bias, bias_rationale, ltp, prev_close,
                           return_pct, vwap, above_vwap, prev_high, prev_low, above_prev_high,
                           below_prev_low, sma: {above_sma20/50/200, sma20/50/200},
                           sector, sector_rank, sector_total, universe_rank, universe_total,
                           sparkline_intraday, sparkline_5d, sparkline_20d, sparkline_60d,
                           drawdown_1w/1m/3m/1y, high_52w, low_52w, pct_from_52w_high/low

BreakthroughSignalsResponse: as_of, kite_live, data_mode, signal_count, signals: [WhyNowCard]
WhyNowCard: id, direction, symbol, signal_type, time, what_happening, why_matters,
            confirm_trigger, invalidate_trigger, entry, target, stop, risk_reward,
            target_pct, stop_pct, priority

StockChartResponse: symbol, bars: [StockChartBar], ranks_tf: {tf: TFRank}
StockChartBar:      t, o, h, l, c, v, sma20, sma50, sma200, dd (drawdown %)
TFRank:             return_pct, universe_rank, universe_total, sector_rank, sector_total
```

---

## Layer 1 — Sector Scatter Map

**API**: `GET /api/live/sectors`

**Chart type**: Highcharts `scatter`. X = `atr_pct`, Y = `return_pct`. One dot per sector.

**Color coding**:
- Green (`#22c55e`) if `return_pct > 0.1` (long bias)
- Red (`#ef4444`) if `return_pct < -0.1` (short bias)
- Neutral (`#94a3b8`) otherwise

**Direction field**: `"long"` if `avg_ret > 0.1`, `"short"` if `< -0.1`, `"neutral"` otherwise.

**Nifty proxy**: Equal-weighted average return of all ~80 symbols. Shown as a dotted `plotLine`
on the Y-axis.

**Quadrant overlay** (absolute-positioned text over the chart):
- Q1 (top-right): "Q1 TRENDING LONG ↗" in green
- Q2 (top-left): "Q2 QUIET STRENGTH" in light green
- Q3 (bottom-left): "Q3 QUIET WEAKNESS" in light red
- Q4 (bottom-right): "Q4 TRENDING SHORT ↘" in red

**Sector chips row**: Below the chart — one clickable chip per sector showing name + return%.
Selected sector gets a filled border.

**Interaction**: Click a dot or chip → triggers Layer 2 drill-down for that sector.

**Auto-refresh**: Every 5 seconds **always** (even when market closed; shows EOD data).

---

## Layer 1 (right panel) — All-Sector Return Progression

**API**: `GET /api/live/sector-progressions`

**Chart type**: Highcharts `line` (one series per sector, 11 lines). Shared tooltip sorted
by return.

**Sector colors** (hardcoded `SECTOR_COLORS` map in frontend):
Banking=#3b82f6, Finance=#6366f1, IT=#22c55e, Energy=#f97316, Auto=#ef4444,
Pharma=#8b5cf6, FMCG=#ec4899, Metals=#64748b, Infrastructure=#f59e0b, Telecom=#14b8a6,
Consumer=#84cc16

**Source indicator badge**:
- Live: pulsing green dot + "LIVE · 5-sec ticks"
- 15-min: amber dot + "15-MIN · {trade_date} · From 9:15 Open"

**Data modes**:
- `source == "live"`: built from `_iday` accumulator, max 78 points per sector
- `source == "15min_kite"`: 15-min bars from Kite, 2 rep symbols per sector averaged, cached per trade date
- `source == "none"`: shows loading placeholder

**When sector is selected**: that line gets `lineWidth: 2.5`; others drop to `opacity: 0.35`.

**Interaction**: Click any series line → triggers Layer 2 drill-down for that sector.

---

## Layer 2 — Sector Drill-Down

**API**: `GET /api/live/sector/{sector_name}` (triggered on sector click)

**Layout**: 4 panels in a `Grid container`. Shown in a full-width CARD below Layer 1.

**Header**: Sector name + return% + "SHORT BIAS" chip (when `vs_nifty < -0.5`) + Corr value.

### Panel 1 — Constituent Scatter (Grid md=6)
Highcharts scatter, X=ATR%, Y=return% for all stocks in the sector. Green/red by return.
Clicking a stock dot → triggers Layer 3.

### Panel 2 — Stocks Return Progression (Grid md=6)
Multi-line Highcharts chart (`stock_progressions` field — per-stock lines, not sector average).
Live: from `_iday` accumulator. Closed: from 15-min Kite historical data.
Click line → triggers Layer 3.
Empty state: "No stock data yet" / "Accumulating live ticks…" / "Fetching 15-min Kite history…"

### Panel 3 — Constituent Mini-Charts (Grid md=8)
Responsive grid (`auto-fill, minmax(130px, 1fr)`). Each card: ticker + return% + `<Spark>`
+ LTP. Sorted strongest → weakest. Click → Layer 3.
Sparkline source priority:
1. Live: `_ltps(sym, 78)` from `_iday` accumulator
2. Closed: `hist_sparklines[sym]` from 15-min Kite data
3. Fallback: last 20 EOD closes from `hist.closes_60d` (reversed to chronological)

### Panel 4 — Intra-Sector Correlation (Grid md=4)
Current correlation value + Highcharts line (correlation history, 20 snapshots).
Y-axis: -1 to 1. Reference lines at 0.7 (amber dashed) and 0.4 (blue dotted).
Color: >0.7=#f59e0b (High), >0.4=#60a5fa (Moderate), else=#22c55e (Low/divergence).
Interpretation box:
- High corr + falling → "↓ High corr + falling = systematic short"
- High corr + rising → "↑ High corr + rising = systematic long"
- Low corr → "⇅ Low corr = divergence opportunities"

---

## Layer 3 — Stock Intelligence Card

**APIs called on stock selection**:
- `GET /api/live/stock/{symbol}` — primary bias/price/SMA/sparkline data
- `GET /api/live/stock/{symbol}/chart` — OHLCV bars, SMA, drawdown, multi-TF ranks
- `GET /api/indicators/{symbol}/edge` — best indicator, grade, current signals
- `GET /api/patterns/{symbol}/dna` — DNA profile (top 3 patterns + win rates)
- `GET /api/patterns/{symbol}/history` — recent pattern history

**Shown in**: Full-width CARD with a close (✕) button. "Full Research →" navigates to `/stock/{symbol}`.

### Bias Header
```
{SYMBOL}  [🟢 LONG / 🔴 SHORT / ⚪ NEUTRAL]  ₹{ltp}  {return%}
{bias_rationale}
```

**Server-side bias logic**:
```python
bull = sum([ret > 0.5, above_sma200, above_sma50, above_vwap, above_prev_high])
bear = sum([ret < -0.5, not above_sma200 and sma200, not above_sma50 and sma50,
            not above_vwap and vwap, below_prev_l])
bias = "long" if bull >= 3 and bull > bear
bias = "short" if bear >= 3 and bear > bull
bias = "neutral" otherwise
```

### TF Selector + Chart Type Toggle
- TF range buttons: 5D | 1M | 3M | 6M | 1Y (default: 3M)
- Chart type toggle: 📊 Candle | 📈 Line
- SMA legend: SMA20=#f59e0b, SMA50=#3b82f6, SMA200=#6366f1

### Highstock Chart (from `/api/live/stock/{symbol}/chart`)
- 365 bars max from DuckDB, sliced to TF range selector
- Price pane (70%): candlestick or area line + SMA20/50/200
- Volume pane (25%): column bars (sub-pane, yAxis index 1)
- Separate `ddOptions` for drawdown area chart (100px height, `max: 0`)
- `constructorType="stockChart"`, no rangeSelector/navigator/scrollbar

### Multi-TF Row (6 mini-cards: 1D, 1M, 3M, 6M, 1Y, 5Y)
`TFCard` component per timeframe: label + return% + `<Spark full>` + price range.
1D = `sparkline_intraday`. All others sourced from `chartData.bars` (daily closes).

### Intelligence Dashboard (Grid lg=9 left + lg=3 right)

**Row A — 3 cards (md=4 each)**:

1. **HEALTH SCORE** (accent #3b82f6): SVG half-circle gauge + 4 progress bars.
   **Client-side computed** from `StockIntelligenceResponse` + `ranks_tf`:
   - Trend (0–25): above_vwap(10) + above_sma20(5) + above_sma50(6) + above_sma200(4)
   - Momentum (0–25): avg universe rank percentile across 1d/1w/1m/3m × 25
   - RS (0–25): avg sector rank percentile across 1d/1w/1m/3m/6m/1y × 25
   - Volume (0–25): `volRatio × directional_factor × 10`, capped at 25
   - Total = sum, capped at 100

2. **TREND STRUCTURE** (accent #f59e0b): 4-row checklist (✓/✗):
   Price > VWAP | Price > SMA20 | Price > SMA50 | Price > SMA200.
   Trend Score (0-4) → label chip: Strong Uptrend / Uptrend / Mixed / Downtrend / Strong Downtrend.

3. **52-WEEK RANGE** (accent #8b5cf6): Gradient slider bar + dot at `pct52w` position.
   Shows 52W Low/High, position%, `pct_from_52w_high`, `pct_from_52w_low`.
   Warning chips when pct52w > 90% or < 10%.

**Row B — 3 cards (md=4 each)**:

4. **RELATIVE STRENGTH** (accent #22c55e): 6 rows (1d/1w/1m/3m/6m/1y).
   Each row: return% + two progress bars (U = universe rank, S = sector rank) + rank counts.
   Color: top 33% = green, bottom 33% = red, middle = amber.

5. **MOMENTUM** (accent #3b82f6): Large return% + label. 20D sparkline. Multi-TF return% strip.

6. **VOLUME ANALYSIS** (accent #ec4899): Volume ratio (X.Xr) + label chip + 20D volume bars.
   Rows: Today / Avg 20D / Trend (Increasing/Stable/Decreasing).

**Row C — 1 wide card (md=4) + 4 compact panels (xs=6, md=2 each)**:

7. **DRAWDOWN ANALYSIS** (accent #ef4444): 2×2 grid of 1W/1M/3M/1Y drawdown values.
   Highcharts area drawdown chart from `chartData.bars` sliced to tfRange.

8. RS TREND 1M — rsLabel + sparkline

9. PRICE MOMENTUM 1M — momLabel + sparkline

10. VOLUME TREND 1M — volLabel + volume bars

11. **INDICATOR EDGE** — grade from `edgeData.grade` + `edgeData.best_indicator` text.

**Row D — 2 cards (md=6 each)**:

12. **KEY PRICE LEVELS** (accent #64748b): Ordered list:
    Resistance 2 | Resistance 1 | Current LTP | Support 1 | Support 2.
    Resistances = SMAs above LTP (sorted asc). Supports = SMAs below LTP (sorted desc).
    Falls back to 52W high/low when no SMA available.

13. **CONCLUSION** (accent #6366f1): 4-5 auto-generated bullets (▲ bull / ▼ bear / ◆ neutral)
    based on trendScore, sector rank, 52W position, volume ratio, and bestPattern.

**Right zone (Grid lg=3)**:

14. **ACTION** (accent = biasColor): "🟢 GO LONG" / "🔴 AVOID" / "⚪ WAIT".
    Conditions checklist: VWAP | SMA20 | Volume | Sector rank top half.

15. **BEST INDICATOR** (accent #8b5cf6): `edgeData.best_indicator` + grade + setup text.
    Active signal chip from `edgeData.current_signals[0]`.

16. **BEST PATTERN NOW** (accent #22c55e): `patternData.items[0]` (most recent pattern + outcome).
    Top 3 from `dnaData.dna` (pattern + win rate).

---

## Layer 4 — Breakthrough Intelligence Engine

**API**: `GET /api/live/signals`

Runs every 5 seconds across all ~80 symbols. Surfaces **non-obvious, high-signal moments**
on both long AND short side. Direction always follows signal, not preference.

**Signal deduplication**: `id = sha256("{symbol}:{signal_type}:{date}")[:16]`. Same (symbol,
signal_type) pair fires at most once per calendar day.

**Min R:R = 1.5** — signals below this threshold are discarded before returning.
**Cap**: 20 signals returned, sorted `(priority ASC, R:R DESC)`.

---

### 4.1 — Structural Breakouts & Breakdowns (Price)

| Priority | Signal Type                      | Direction | Detection Logic                                                     | Status      |
| -------- | -------------------------------- | --------- | ------------------------------------------------------------------- | ----------- |
| 1        | 52-Week High Breakout            | 🟢 Long   | `ltp > high_52w` AND `vol_ratio >= 1.5`                            | ✅ Built     |
| 1        | 52-Week Low Breakdown            | 🔴 Short  | `ltp < low_52w` AND `vol_ratio >= 1.5`                             | ✅ Built     |
| 2        | Consolidation Breakout           | 🟢 Long   | ATR compressed + `ltp > high_10d` AND `vol_ratio >= 1.2`           | ✅ Built     |
| 2        | Consolidation Breakdown          | 🔴 Short  | ATR compressed + `ltp < low_10d` AND `vol_ratio >= 1.2`            | ✅ Built     |
| 5        | VWAP Reclaim Post Gap-Up         | 🟢 Long   | Gap-up open (`> prev_close × 1.005`) + `ltp > vwap` AND `ltp > open` | ✅ Built  |
| 5        | VWAP Rejection Post Gap-Down     | 🔴 Short  | Gap-down open (`< prev_close × 0.995`) + `ltp < vwap` AND `ltp < open` | ✅ Built |
| 6        | Intraday Golden Cross (15-min)   | 🟢 Long   | SMA20 crosses above SMA50 on 15-minute chart                        | 🔲 Planned  |
| 6        | Intraday Death Cross (15-min)    | 🔴 Short  | SMA20 crosses below SMA50 on 15-minute chart                        | 🔲 Planned  |

**ATR compression** (for consolidation signals): `atr_5d < 0.6 × atr_prior_20d` AND `atr_prior_20d > 0`.

**Volume confirmation ratio**: `vol_ratio = current_volume / avg_vol20`. In EOD fallback,
uses `today_volume` from `_hist` (DuckDB `rn=1` volume).

**Trade structure computation** (server-side, `_make_card()`):
- 52W: `entry = ltp ± 0.1%`, `target = ltp ± 8%`, `stop = 52w_level ± 1%`
- Consolidation: `entry = ltp ± 0.1%`, `target = ltp ± 3×ATR14`, `stop = range_boundary ± 1%`
- VWAP: `entry = vwap ± 0.1%`, `target = vwap ± 2×ATR14`, `stop = vwap ± 0.5%`

---

### 4.2 — Momentum Inflection Signals

| Priority | Signal Type                       | Direction | Detection Logic                                                      | Status     |
| -------- | --------------------------------- | --------- | -------------------------------------------------------------------- | ---------- |
| 3        | Rank Jump ≥ 20 (up)               | 🟢 Long   | Intra-sector return rank moved up ≥ 20 spots in last 30 min         | 🔲 Planned |
| 3        | Rank Drop ≥ 20 (down)             | 🔴 Short  | Intra-sector return rank moved down ≥ 20 spots in last 30 min       | 🔲 Planned |
| 3        | Sector ATR Expansion (up move)    | 🟢 Long   | Sector ATR > 1.5× 5-day avg ATR AND sector return positive          | 🔲 Planned |
| 3        | Sector ATR Expansion (down move)  | 🔴 Short  | Sector ATR > 1.5× 5-day avg ATR AND sector return negative          | 🔲 Planned |
| 4        | Correlation Drop + Stock Strength | 🟢 Long   | Sector correlation drops > 0.25 in 30 min + stock outperforming sector | 🔲 Planned |
| 4        | Correlation Drop + Stock Weakness | 🔴 Short  | Sector correlation drops > 0.25 in 30 min + stock underperforming sector | 🔲 Planned |

**Implementation notes for planned signals**:
- Rank signals require the `_iday` accumulator to hold 30-min of ticks. Compute running intra-sector
  rank per 5-sec snapshot and compare `rank_now` vs `rank_30min_ago`.
- Sector ATR expansion: compare current intraday ATR (high-low of session so far) against
  `atr_prior_20d` from `_hist`.
- Correlation drop: use `_corr_history(syms, n_snaps=20)` — already computed in Layer 2.
  Signals require `corr[-1] - corr[-6] < -0.25` (approx 30 min back at 5s cadence = 360 ticks,
  n_snaps=20 → each snap ≈ 18 ticks ≈ 90s, so 6 snaps ≈ 9 min; adjust `n_snaps` for finer granularity).

**Two-signal confirmation rule** (Priority 4–6): signals at Priority 4 (OI/correlation),
5 (VWAP), and 6 (SMA cross) should require at least one other confirming signal before surfacing.
Priority 1–3 can fire standalone.

---

### 4.3 — Signal Priority Matrix

When multiple signals fire simultaneously, prioritize in this order:

| Priority | Signal Type                         | Rationale                                      |
| -------- | ----------------------------------- | ---------------------------------------------- |
| 1        | 52-week high/low breach + volume    | Structural — highest conviction, rare          |
| 2        | Consolidation breakout/breakdown    | Structural — high conviction, pattern-based    |
| 3        | Rank jump/drop ≥ 20 + ATR expansion | Momentum — confirms institutional activity     |
| 4        | OI buildup + PCR shift              | Options confirmation — smart money positioning |
| 5        | VWAP reclaim/rejection              | Intraday — lower timeframe, tactical           |
| 6        | SMA cross (15-min)                  | Intraday — directional shift, lower conviction |

Priority 1 alone → generates a Why Now Card.
Priority 4–6 require ≥ 1 other confirming signal.

---

### 4.4 — Why Now Card

For every triggered signal, generate a directional insight card:

```
🟢 LONG SIGNAL  /  🔴 SHORT SIGNAL          ← direction tag
STOCK: [TICKER] | SIGNAL: [Signal Type] | TIME: [HH:MM]

📍 WHAT IS HAPPENING
   [Factual, specific observation — price level, % move, signal that fired]

🔍 WHY IT MATTERS
   [Structural or behavioral context — historical pattern, positioning implication]

⚡ WHAT TO WATCH NEXT
   Confirm:     [trigger to enter — specific price level or condition]
   Invalidate:  [trigger to abandon — specific price level or condition]

📊 TRADE STRUCTURE
   Entry:       ₹[X]
   Target:      ₹[X]  (+[X]%)
   Stop:        ₹[X]  (-[X]%)
   Risk:Reward: [X:X]
```

### WhyNowCard UI (`WhyNowCardView` component)

Cards arranged in 2-column grid on md+: `gridTemplateColumns: repeat(2, 1fr)`.

**Compact header** (always visible, click to expand):
- Direction tag (🟢 LONG / 🔴 SHORT) + symbol + signal_type + time + R:R chip (right-aligned)
- `what_happening` sentence below the header row
- Left border: `3px solid {color}` (green or red), subtle `bgcolor` tint

**Expanded detail** (revealed on click):
- WHY IT MATTERS paragraph
- Confirm / Invalidate side-by-side boxes (Grid 2×1)
- Trade structure: Entry | Target (`+X%`) | Stop (`−X%`) in mini-cards
- "Analyse →" button → navigates to `/stock/{card.symbol}`

**`WhyNowCard` fields**: `id`, `direction`, `symbol`, `signal_type`, `time`, `what_happening`,
`why_matters`, `confirm_trigger`, `invalidate_trigger`, `entry`, `target`, `stop`,
`risk_reward`, `target_pct`, `stop_pct`, `priority`.

### Signal Priority sidebar (Grid lg=4, right of signals panel)

Static reference card listing Priority 1/2/5 signals with one-line rationale each.
(Priority 3/4/6 not listed since those signals are not yet built.)

---

## Frontend Architecture

### Key sub-components

| Component                    | Purpose                                            |
| ---------------------------- | -------------------------------------------------- |
| `LiveBadge`                  | Pulsing dot: FETCHING(CYAN) / LIVE(green) / KITE OFFLINE(amber) |
| `SectionHead`                | Accent bar + title + optional right-aligned meta   |
| `Spark`                      | Inline SVG sparkline with gradient fill area       |
| `SectorScatterMap`           | Layer 1 scatter + quadrant labels + chip row       |
| `AllSectorsProgressionChart` | Layer 1 multi-line progression chart               |
| `SectorDrillDown`            | Layer 2 container (4 panels)                       |
| `ConstituentScatter`         | Layer 2 Panel 1 scatter                            |
| `StocksProgressionChart`     | Layer 2 Panel 2 per-stock lines                    |
| `IntradayChart`              | Layer 2 sector area chart (unused in Panel 2 now)  |
| `CorrelationChart`           | Layer 2 Panel 4 correlation history                |
| `StockIntelligenceCard`      | Layer 3 full card (chart + all panels)             |
| `HealthGauge`                | SVG half-circle score gauge                        |
| `TFCard` + `MultiTFRow`      | 6 multi-TF mini sparkline cards                    |
| `WhyNowCardView`             | Layer 4 expandable signal card                     |

### Constants

```ts
const REFRESH_MS = 5000
const SECTOR_COLORS = { Banking: '#3b82f6', Finance: '#6366f1', IT: '#22c55e', ... }
const TF_RANGES = ['5D', '1M', '3M', '6M', '1Y']
const TF_DAYS = { '5D': 5, '1M': 21, '3M': 63, '6M': 126, '1Y': 252 }
const TF_KEYS = ['1d', '1w', '1m', '3m', '6m', '1y']
```

### Auto-refresh logic

```ts
// On mount + every REFRESH_MS:
fetchSectors()          // always — even when market closed
fetchSignals()          // mount + isMarketOpen() only
fetchProgressions()     // mount + isMarketOpen() only
if (selectedSector) fetchDrillDown(selectedSector)   // isMarketOpen() only
if (selectedStock)  fetchStock(selectedStock)          // isMarketOpen() only
```

`isMarketOpen()` = Mon–Fri, IST 9:15 (minute 555) to 15:30 (minute 930).

IST conversion: `new Date(n.getTime() + (n.getTimezoneOffset() + 330) * 60000)`

---

## Hero Section

- `LiveBadge`: loading→CYAN, kiteOk→green, else amber
- "MARKET CLOSED" badge when `!isMarketOpen()`
- "EOD DATA — 3:30 PM CLOSE" badge when `data_mode === 'eod_fallback'`
- Title: `Sector & Stock Intelligence` (CYAN on "Intelligence")
- Refresh countdown: "Refresh in {N}s" (yellow ≤ 3s); "Paused — market closed"
- Signal count badge: "{N} SIGNALS ACTIVE" in amber (only when `sigCount > 0`)
- Hero gradient: standard dark/light from `BG` palette token

---

## What's NOT Built (in original spec but not implemented)

- OI buildup / PCR signals (Layer 4)
- Rank jump ≥ 20 positions (Layer 4)
- Intraday SMA golden/death cross (Layer 4)
- Nifty overlay line on Layer 2 Panel 2 (stock progressions only, no Nifty line)
- **`/live-trading` route not wired in `App.tsx`** — must be added before page is accessible

---

## Lessons / Gotchas

- **EOD return_pct = today's 3:30 PM close vs yesterday's close** (not open-to-close). DuckDB
  `rn=1` is the most recent bar close; `rn=2` is yesterday's close.

- **Consolidation signals use `high_10d_prior` in EOD fallback** to avoid today's own close
  being inside the 10-day range and blocking all breakout signals when market is closed.

- **`_iday` is empty on first server request** before any Kite tick arrives. Layer 2 mini-charts
  and Layer 3 `sparkline_intraday` will show EOD fallback sparklines on first load.

- **`stock_progressions` is `None` when market is closed**. The 15-min Kite data fills it instead.

- **Health Score is purely client-side** — not returned by any API. Computed in `StockIntelligenceCard`
  from `StockIntelligenceResponse` + `StockChartResponse.ranks_tf`.

- **`_avg_pairwise_corr` needs ≥5 data points per symbol** in `_iday`. Returns 0.0 below that.
  Correlation history (`_corr_history`) needs ≥15 ticks. Both show "Building history…" early on.
