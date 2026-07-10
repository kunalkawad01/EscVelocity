# Implementation — MarketDNA / DHARM stack

Stack: FastAPI + DuckDB + APScheduler + Kite Connect + React/Highcharts/Highstock. Delivered as a **separate page** with a 5-second refresh.

## Two hard rules

1. **Never poll every stock's full option chain** — it blows the Kite rate limit instantly. Option-chain depth is on-demand, per open panel only.
2. **Precompute static fields at 09:00** (ATR, DMAs, prev-close OI, sector map) from the DuckDB historical store. The 5s loop refreshes only live price + OI.

## Kite call-budget plan (tiered)

Universe ≈ 2,100 instruments; Kite quote endpoint ≤ 500 instruments/call, ~3 req/sec.

- **Universe scan (Zones 0–2):** LTP/OHLC quote in chunks of 500 → ~5 REST calls, every **5s** via APScheduler. Comfortably within budget.
- **Focus stream (Zone 3):** the open panel's ~15 tokens (future + 7 CE + 7 PE). Use the **Kite WebSocket ticker**, not REST — it gives tick data without consuming the REST budget and delivers clean 5s granularity. Subscribe on panel open, **unsubscribe on close**.

## APScheduler jobs

```
job_precompute_static   cron  09:00  -> writes static fields to DuckDB (ATR, DMA20/50, slope, prev_close, prev OI, sector map)
job_universe_scan       interval 5s  09:15-15:30 -> REST quote in 500-chunks; compute ret_pct, ret_per_atr,
                                                    quadrant, vwap, rel_strength, breadth verdict; push to cache/WS
job_focus_stream        managed by WS ticker; lifecycle tied to open panel (start on click, stop on close)
```

## FastAPI endpoint contracts

```
GET  /api/fno/universe        -> [{symbol, sector, ret_pct, ret_per_atr, oi_chg_pct,
                                    quadrant, trend, above_vwap, rel_strength,
                                    day_high, day_low, liquid: bool, extended: bool}]
GET  /api/fno/breadth         -> {verdict: RISK_ON|RISK_OFF|NEUTRAL,
                                  pct_above_vwap, adv_decl, nifty_from_0915}
GET  /api/fno/normalized      -> {t: [...], series: {SYMBOL: [...], NIFTY: [...], SECTOR: [...]}}
GET  /api/fno/optionchain/{symbol}
                              -> {atm_strike, future: {...},
                                  strikes: [{strike, ce_oi, pe_oi, ce_ltp, pe_ltp}, ...7],
                                  ts}
WS   /ws/fno/focus/{symbol}   -> streams future/CE/PE price+OI ticks for the ATM±3 set
WS   /ws/fno/universe         -> optional push channel for the 5s universe frame
```

Signal grading (from strategy.md) can live server-side as a `grade(symbol)` helper returning `{direction, grade: A|B|NONE, size: full|half|none, reasons: [...]}` so the client just renders it.

## DuckDB precompute (09:00 job)

From the 6-yr OHLCV store, per symbol: `atr_14d`, `dma_20`, `dma_50`, `dma_50_slope` (e.g. slope of 50-DMA over last 5 sessions), `prev_close`, `prev_close_oi`, and the `symbol → sector_index` map. Write to a `static_today` table keyed by symbol; the 5s loop joins against it — no live TA recompute.

## React component tree

```
<FnoTacticalPage>                      // polls /universe + /breadth + /normalized every 5s
 ├─ <BreadthGate/>                      // Zone 0 strip; verdict + 3 metrics; drives enable/suppress
 ├─ <PositioningScatter/>              // Zone 1; Highcharts bubble; X=ret_pct Y=ret_per_atr
 │     onBubbleClick(symbol) -> setFocus(symbol)
 ├─ <NormalizedLines/>                 // Zone 2; Highstock; watchlist + NIFTY + SECTOR rebased to 0 @09:15
 └─ <OptionChainPanel symbol={focus}/> // Zone 3; opens WS /ws/fno/focus/{symbol}
       ├─ <FutureOIChart/>             // dual-axis, price line + OI STEP-line
       ├─ <CallOIChart/>               // dual-axis, price line + OI STEP-line
       ├─ <PutOIChart/>                // dual-axis, price line + OI STEP-line
       └─ <StrikeLadder/>              // 7 rows: CE OI | strike | PE OI  (S/R map)
       // unmount -> close WS, unsubscribe tokens
```

## Rendering notes

- **OI series = `type: 'line', step: 'left'`** on every chart. Kite intraday OI steps (refreshes periodically) while price streams — interpolating OI shows false precision.
- Rolling window: drop points older than the intended live window on the focus charts to keep them light.
- Theme: reuse the existing dark/gold MarketDNA theme, IBM Plex Mono for numeric axes.
- Package as two SKILL.md-style plugins consistent with the rest of the platform: one for the universe scatter/breadth/lines, one for the option-chain focus panel.

## Build order (suggested)

1. `job_precompute_static` + `static_today` table.
2. `job_universe_scan` + `/universe` + `/breadth` + scatter + breadth strip.
3. `/normalized` + normalized lines.
4. WS focus + option-chain panel (last, since it depends on click wiring).
5. Server-side `grade()` helper + inline signal badges on scatter bubbles.
