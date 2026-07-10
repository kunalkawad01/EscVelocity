---
name: fno-live-tactical-dashboard
description: Build and maintain a live intraday F&O tactical trading dashboard for the Indian market (Nifty 500 / F&O universe) on a dedicated page that refreshes every 5 seconds. Use this skill whenever the user wants an intraday positioning dashboard, an OI-based scatter (Returns vs ATR), a normalized 9:15 relative-strength line chart, a market breadth gate, or a click-to-drill option chain panel (Future/Call/Put price-vs-OI). Trigger on mentions of "F&O dashboard", "OI scatter", "long buildup / short buildup / short covering / long unwinding", "positioning quadrants", "intraday trend-aligned entries", "option chain drilldown", "ATM ± 3 strikes", or any request to plan or code a live trade-decision page in the MarketDNA / DHARM stack (FastAPI + DuckDB + APScheduler + Kite Connect + React/Highcharts/Highstock).
---

# F&O Live Tactical Dashboard

A dedicated, self-refreshing (5s) intraday decision page. Its single job: surface **trend-aligned pullback entries** — buy dips in monthly uptrends, sell rallies in monthly downtrends — and confirm each with OI positioning and, on demand, the live option chain.

The dashboard never generates the trade by itself. It stacks four filters (**breadth gate → positioning scatter → timing line → option-chain confirmation**) so the human takes only high-conviction, trend-aligned trades and skips the rest.

## The one principle everything serves

Trade **WITH the monthly trend, AGAINST the intraday move.** Every panel, color, and threshold exists to enforce this. If a component ever suggests trading against the monthly trend, it's a bug in the logic, not a signal.

---

## Page layout (4 zones, one screen)

```
┌─────────────────────────────────────────────────────────┐
│  ZONE 0 — BREADTH GATE (top strip, always visible)       │
│  Risk-ON / Risk-OFF / NEUTRAL + % above VWAP, A/D, Nifty │
├───────────────────────────────┬─────────────────────────┤
│  ZONE 1 — OI POSITIONING       │  ZONE 3 — OPTION CHAIN  │
│  SCATTER (Returns vs ATR)      │  DRILLDOWN (on click)   │
│  click a bubble ───────────────┼──▶ 3 live charts:       │
│                                │   Future px vs OI       │
├───────────────────────────────┤   Call  px vs OI        │
│  ZONE 2 — NORMALIZED 9:15      │   Put   px vs OI        │
│  LINES (relative strength)     │   + ATM±3 strike ladder │
└───────────────────────────────┴─────────────────────────┘
```

Refresh cadence: **Zones 0–2 every 5 seconds** (universe scan). **Zone 3 also every 5 seconds** while a panel is open (focus stream), torn down on close to protect the API budget.

---

## Per-stock data model

Compute/cache these fields for every F&O-universe symbol on each 5s scan. Anything that doesn't change intraday (ATR, DMAs, prev-close OI, sector map) is precomputed once at 09:00 from the DuckDB historical store — never recomputed live.

| Field                          | Meaning                                  | Source         |
| ------------------------------ | ---------------------------------------- | -------------- |
| `symbol, sector`               | identity + sector index map              | static (09:00) |
| `prev_close`                   | yesterday's close                        | static         |
| `open_0915`                    | today's first-tick / opening price       | first scan     |
| `ltp`                          | last traded price                        | live scan      |
| `ret_pct`                      | `ltp/open_0915 - 1` — **X-axis**         | live           |
| `atr_14d`                      | 14-day ATR                               | static (09:00) |
| `ret_per_atr`                  | `(ltp - open_0915)/atr_14d` — **Y-axis** | live           |
| `oi, oi_prev_close`            | current & prior-day OI                   | live / static  |
| `oi_chg_pct`                   | `oi/oi_prev_close - 1` — **bubble size** | live           |
| `quadrant`                     | positioning state — **color**            | derived        |
| `vwap, above_vwap`             | session VWAP + flag                      | live           |
| `dma_20, dma_50, dma_50_slope` | monthly-trend inputs                     | static (09:00) |
| `trend`                        | `UP` / `DOWN` / `NONE`                   | derived        |
| `rel_strength`                 | `stock_norm - nifty_norm`                | live           |
| `day_high, day_low`            | for V/inv-V detection + stops            | live           |
| `volume, oi_base`              | liquidity floor                          | live / static  |

### Derived-field rules (implement exactly)

**Monthly trend (non-repainting):**

- `UP` if `ltp > dma_50 AND dma_20 > dma_50 AND dma_50_slope > 0`
- `DOWN` if `ltp < dma_50 AND dma_20 < dma_50 AND dma_50_slope < 0`
- else `NONE` → symbol is excluded from BOTH long and short lists (sit out chop).

**Quadrant** (`price_dir = sign(ltp - prev_close)`, `oi_dir = sign(oi - oi_prev_close)`):
| price_dir | oi_dir | quadrant | color |
|---|---|---|---|
| + | + | `LONG_BUILDUP` | green |
| + | − | `SHORT_COVERING` | light green |
| − | + | `SHORT_BUILDUP` | red |
| − | − | `LONG_UNWINDING` | light red |

---

## Zone 0 — Breadth gate (the "should I trade at all today")

A single verdict computed from the whole universe each scan:

- `pct_above_vwap` = share of universe trading above its own VWAP
- `adv_decl` = advancers ÷ decliners
- `nifty_from_0915` = Nifty's own normalized return since 09:15

Verdict:

- **Risk-ON** if `pct_above_vwap > 60% AND nifty_from_0915 > 0 AND adv_decl > 1.5` → longs enabled, shorts suppressed.
- **Risk-OFF** if `pct_above_vwap < 40% AND nifty_from_0915 < 0 AND adv_decl < 0.67` → shorts enabled, longs suppressed.
- **NEUTRAL** otherwise → take only A-grade signals, half size.

Rationale: an individual stock's "uptrend" can conflict with a market-wide risk-off day. The gate stops the user taking 15 trend-aligned longs on a day the whole tape is rolling over. This is the highest-value filter and it's why it sits on top.

---

## Zone 1 — OI positioning scatter (the "what")

- **X:** `ret_pct` (intraday return from 09:15)
- **Y:** `ret_per_atr` (risk-adjusted move — how many ATRs travelled). Use this, NOT raw ATR: a 2% move in a low-ATR name is a bigger signal than 2% in a high-ATR name, and Y must carry that information.
- **Bubble size:** `|oi_chg_pct|`
- **Color:** `quadrant`
- Draw faint quadrant gridlines at X=0 and Y=0.
- **Extended-move shading:** shade `|ret_per_atr| > 1.5` regions — bubbles there are late (the pullback is already spent); the user should avoid initiating there.

Clicking any bubble opens Zone 3 for that symbol.

---

## Zone 2 — Normalized 9:15 lines (the "when")

- Every watchlist symbol rebased to 0% at 09:15.
- Overlay **Nifty** and the symbol's **sector index** on the same axis (relative strength read).
- The user hunts **inflection shapes**: a completed **V** (down-then-up) for longs, a completed **inverted-V** (up-then-down) for shorts. The scatter shows the current state; this line catches the _turn_, which is where the edge actually lives.

---

## Zone 3 — Option chain drilldown (the "final confirmation")

Opens on bubble click. Steps:

1. ATM = strike nearest the current-month **future** LTP.
2. Load **ATM ± 3 strikes** (7 strikes × CE + PE = 14 legs) + the future.
3. Subscribe those ~15 tokens to the 5s focus stream.
4. Render three dual-axis charts + a strike ladder.

**Three live charts (5s refresh, dual-axis, price left / OI right):**

1. **Future price vs Future OI** — confirms the underlying move in real time.
2. **Call price vs Call OI** — call OI↑ + price↑ = fresh call longs (bullish); call OI↑ + price↓ = call writing (resistance/bearish).
3. **Put price vs Put OI** — put OI↑ + price↑ = fresh put longs (bearish); put OI↑ + price↓ = put writing (support/bullish).

**Strike ladder** (7 rows): show CE OI and PE OI side by side so heavy call OI above (resistance) and heavy put OI below (support) are visible at a glance — your live intraday S/R map.

**CRITICAL data-vendor caveat:** Kite intraday **OI steps, price streams.** Price updates every 5s; OI refreshes periodically. Render every OI series as a **step-line, never interpolated**, so the user doesn't read false precision into OI. This is a known vendor limitation, not a bug — encode it in the chart config.

---

## The strategy (defined for both directions)

Read `references/strategy.md` for the full entry/exit checklists, the quadrant→signal-quality grade table, stop placement, and the option-chain confirmation logic for LONG and SHORT. Load it whenever writing or reviewing the signal-generation code, or when the user asks how a signal is graded.

The short version: LONG only in `UP` trend + Risk-ON, on a completed V above VWAP, with `LONG_BUILDUP` (A-grade) or `SHORT_COVERING` (B-grade, half size). SHORT only in `DOWN` trend + Risk-OFF, on a completed inverted-V below VWAP, with `SHORT_BUILDUP` (A-grade) or `LONG_UNWINDING` (B-grade, half size). A-grade = fresh conviction (OI rising your way); B-grade = other side capitulating (OI falling) — real but shorter-lived, so smaller and quicker.

---

## Implementation (MarketDNA / DHARM stack)

Read `references/implementation.md` for the FastAPI endpoint contracts, APScheduler job definitions, the tiered Kite Connect call-budget plan (REST for the 5s universe scan, WebSocket ticker for the focus stream), the DuckDB precompute job, and the React/Highstock component tree. Load it whenever scaffolding the page or wiring data.

Two hard rules that shape the whole build:

1. **Never poll the full option chain of every stock** — it blows the rate limit instantly. Option-chain depth is on-demand, per open panel only.
2. **Precompute static fields at 09:00**; the 5s loop only refreshes live prices and OI.

## Market state (closed / pre-open / holiday)

The page is live-only by default and will show dangerously stale data off-session unless a state machine gates it. Read `references/market-state.md` for the `resolve_market_state` resolver, the NSE-calendar check, per-state scheduler + UI behavior, and the EOD-settlement job. Load it whenever wiring the scheduler, the page shell, or the status pill.

The core invariants: resolve state via the **NSE trading calendar, never the clock alone**; **never fire the 5s scan or open the focus WS unless state is `LIVE`**; **never render a frame without a state pill + session-date stamp** (a frozen scatter that looks live is the worst failure); and the `CLOSED` frame is the **settled EOD frame**, not the last live tick.

---

## Non-negotiable pre-filters (apply before any signal fires)

1. **Liquidity floor** — enforce a minimum `oi_base` and minimum today's `volume`. OI-change reads on illiquid names are noise, and the quadrant coloring becomes meaningless.
2. **Time-of-day** — suppress V/inverted-V signals for the first **45–60 minutes**. The 09:15 base needs the opening-auction noise to settle before the normalized shapes are trustworthy. Never trade the first candle's normalization.

## Why the stack works

No single filter is strong. Trend-alignment gives positive base-rate expectancy; the pullback entry gives defined risk near structure; OI confirmation kills fake moves; relative strength picks the right horse; the breadth gate stops trading against the tape; the option chain reads live S/R and exit risk. Stacked, they cut trade count sharply but raise average quality — exactly what a discretionary intraday system needs.
