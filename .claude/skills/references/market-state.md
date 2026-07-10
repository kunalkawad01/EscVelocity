# Market state — closed / pre-open / holiday handling

The dashboard is live-only by default and will show dangerously stale data off-session unless a market-state machine gates everything. A frozen scatter that looks live is the worst failure mode here — a trader can act on yesterday's positioning thinking it's now. Everything below exists to make "not live" impossible to miss.

## The state resolver

A single `resolve_market_state(now)` drives the whole page. Resolve it on every poll and on page load. It must consult the **NSE trading calendar**, not just the clock.

| State | Condition | What's ready |
|---|---|---|
| `PRE_PRECOMPUTE` | trading day, before 09:00 | nothing — static tables not built yet |
| `PRE_OPEN` | trading day, 09:00–09:15 | static data ready; no live prices |
| `LIVE` | trading day, 09:15–15:30 | everything (full spec) |
| `CLOSED` | trading day, after 15:30 | last session's final settled frame |
| `HOLIDAY` | weekend or NSE holiday | last trading day's settled frame |

Note the special case: some days have a **Muhurat** (Diwali) special session — a short evening window. Treat it as `LIVE` for its published hours via the calendar, not the normal 09:15–15:30 clock.

## NSE trading-calendar check (required)

Do NOT gate on time-of-day alone. Markets close ~15 holidays/year plus every weekend, and the scheduler will otherwise scan on Republic Day and serve stale ticks.

- Maintain an `nse_holidays_YYYY` list (equity segment), refreshed annually from the NSE circular.
- `is_trading_day(date)` = weekday AND not in holiday list.
- Store the calendar in DuckDB (`nse_calendar` table) so both the scheduler and the API read the same source.
- On the last-day-before-a-holiday, the `CLOSED` frame simply persists across the holiday as the most recent settled session — no special logic needed beyond `resolve_market_state` returning `HOLIDAY`.

## Scheduler behavior per state

```
job_precompute_static  -> runs 09:00 ONLY on is_trading_day; skip weekends/holidays
job_universe_scan      -> runs 5s ONLY while state == LIVE; otherwise idle (do not poll)
job_focus_stream (WS)  -> connectable ONLY while state == LIVE; reject/deactivate otherwise
job_eod_settlement     -> NEW: runs once ~15:40 on trading days -> pull official EOD close + settled OI,
                          write the CLOSED frame (see settlement note below)
```

Idle means idle: when not `LIVE`, the 5s job must not fire REST calls. Serving a frozen cached frame is correct; hitting Kite for stale quotes is not.

## Per-state UI behavior

**Global:** a persistent status pill (reuse dark/gold theme) always shows the state and the frame's session date, e.g. `● LIVE 12:41` / `■ CLOSED — showing 02 Jul close` / `○ PRE-OPEN — waiting for 09:15`. Never render a frame without this stamp.

**`LIVE`** — full spec, everything enabled.

**`CLOSED` / `HOLIDAY`** — "Market closed" mode:
- Freeze and display the **settled EOD frame** (not the last live tick — see below), banner: "Showing close of {date}".
- Stop the 5s poller.
- Grey out + disable the **breadth gate** (session-only concept) and the **option-chain focus panel** (WS is dead off-session). Clicking a bubble shows "Live option chain available during market hours" rather than a blank panel.
- The scatter and trend labels remain useful for planning tomorrow — keep them visible but clearly stamped as end-of-day.

**`PRE_OPEN`** — "planning" mode:
- Show static setup from yesterday's close: `UP` / `DOWN` / `NONE` trend classification per stock, prev-close OI, strike ladders.
- Disable all intraday signals — V/inverted-V detection, breadth verdict, entry grading — with a "waiting for open" state. None of the timing logic is valid until the session establishes `open_0915` and enough post-open time passes for the 45–60 min filter.
- Scatter can render trend/positioning from prev close but `ret_pct`/`ret_per_atr` axes are blank/zeroed with a note.

**`PRE_PRECOMPUTE`** — "not ready" splash: "Daily data builds at 09:00." No scatter (static tables empty). Cheapest correct behavior — don't try to render.

## Settlement note (accuracy at the 15:30 boundary)

The last 15:29:59 tick ≠ the official settled close/OI. If the `CLOSED` frame is used to plan tomorrow's trades, it must reflect **settled** numbers.

- `job_eod_settlement` (~15:40) pulls official EOD close and settled OI, recomputes final `quadrant` per stock, and writes that as the canonical `CLOSED` frame.
- Between 15:30 and 15:40, show `CLOSED` with a "settling…" sub-label, then swap to the settled frame once the job completes.

## Guard rails (encode as invariants)

1. Never display a price/OI frame without a state pill + session-date stamp.
2. Never fire the 5s REST scan when `state != LIVE`.
3. Never open the focus WS when `state != LIVE`.
4. Always resolve state via the NSE calendar, never the clock alone.
5. The `CLOSED` frame is the settled EOD frame, not the last live tick.
