# F&O Momentum Radar — `/fno-momentum`

## What It Does

Bifurcates the NSE F&O stock-futures universe into two positioning buckets and shows only
the names that also carry a momentum qualifier:

1. **OI Gainers** — current-month futures open interest higher than the prior session
   (fresh positions being added, either side).
2. **Short Covering** — price up while futures OI falls (shorts buying back; quadrant
   `SHORT_COVERING` from the tactical scan).

A stock is listed in a bucket only if it passes **at least one** of three momentum criteria,
shown as chips per row:

| Chip | Criterion | Threshold |
|------|-----------|-----------|
| `±5% PREV` | Last completed trading session moved beyond ±5% | `abs(last_session_ret) ≥ 5` |
| `TOP SECTOR` | Stock's sector is today's single best-performing F&O sector by mean day change | top `1` |
| `±2% @ 9:15` | 9:15 open gapped beyond ±2% vs previous close | `abs(gap_0915_pct) ≥ 2` |

Rows show live price (LTP), day change %, futures OI change %, last-session return, and 9:15
gap — **sorted by day change % descending**. A "Best Performing Sector" strip above the lists
shows the single top sector with average return and stock count. Polls every 5s while `state === LIVE`;
off-session it serves the EOD-settled frame.

A **Download PDF** button in the hero exports both lists as a landscape PDF (`jspdf` +
`jspdf-autotable`, fully client-side — no backend endpoint): title/session header, top-sectors
line, both tables with sign-colored % columns, per-row criteria, and a qualifier legend.
Filename: `fno-momentum_<session>_<HHMM>.pdf`.

A third pair of lists, **Open = High** and **Open = Low**, slices the union of the two buckets
above (names already qualifying on OI addition or short covering, plus a momentum chip) by
intraday positioning:

- **Open = High** — the 9:15 open still equals the day's high so far (price has never traded
  above the open) — sellers held the line; a weak/resistance read.
- **Open = Low** — the 9:15 open still equals the day's low so far (price has never traded
  below the open) — buyers held the line; a strong/support read.

Rows show the same OI/change columns plus **9:15 Open · Day High · Day Low** so the qualifying
level is visible directly (the matching column is bold/colored). Equality uses a `±0.005`
tolerance since both values are independently rounded to 2dp from the same Kite quote.

A fourth section, **Live Movers**, is independent of all of the above: it lists
every F&O stock currently trading beyond **±2%** vs previous close (live), split into a
gainers table and a losers table, sorted by day change %. No momentum qualifier required —
this is a plain live-move screen. Included in the PDF export alongside the other tables.

## Optimization

- **Zero extra Kite calls.** `fno_momentum_service.get_scan()` piggybacks entirely on
  `fno_tactical_service._get_scan()` (single Kite pass, 4s-slot cache shared with
  `/fno-tactical`) plus `live_trading_service._get_hist()` (daily DuckDB cache). The
  marginal cost per request is pure Python over ~200 rows — microseconds.
- Polling only runs while LIVE; the interval is torn down on state change and unmount.
- `POST /api/fno-momentum/invalidate` delegates to `fno_tactical_service.invalidate()` —
  functionally identical to `/api/fno/invalidate`, so the post-market Step 2 list already
  covers this page.

## Lessons Learnt

- `equities_prices` rn=1/rn=2 semantics shift intraday: during LIVE, rn=1 is *yesterday*
  (today not ingested), so `prev_close / yesterday_close` is yesterday's move; after
  post-close ingestion rn=1 becomes today, and the same pair yields today's completed move.
  Both are correct readings of "the last trading session" — see
  `fno_momentum_service._last_session_ret()`.
- Short-covering rows by definition have falling OI, so the two buckets are naturally
  disjoint (`elif` on `oi_chg_pct > 0`); SHORT_BUILDUP names (price down, OI up) land in
  OI Gainers, which is intended — "OI gainers" is direction-agnostic.
- Open=High and Open=Low are derived, not independently gated — they read `open_0915`,
  `day_high`, `day_low` off the already-filtered `oi_gainers + short_covering` rows rather
  than re-running the momentum/OI criteria. A stock can appear in neither, one, or (in
  principle, if high==low intraday) both new lists.

## Business Logic

- Base signal is **futures data only** (current monthly contract): OI vs prior session from
  `futures_chain` parquet (live OI via Kite quote while LIVE — `oi_live: true` in response).
- Quadrant logic (`SHORT_COVERING` = price↑ + OI↓) comes from `fno_tactical_service._quadrant`.
- Sector performance = mean of `(ltp/prev_close − 1)%` across each sector's F&O symbols
  (sector map from `ind_nifty500list.csv` via `live_trading_service.SECTOR_MAP`).
- Thresholds are constants in `fno_momentum_service` (`_BIG_MOVE_PCT=5`, `_GAP_PCT=2`,
  `_TOP_SECTORS_N=1`, `_LIVE_MOVE_PCT=2`) and echoed in the response `thresholds` object
  so the UI never hardcodes them.
- `movers_up` / `movers_down` are computed over the full `enriched` list (whole F&O
  universe), gated only on `abs(change_pct) ≥ _LIVE_MOVE_PCT` — no relation to the
  OI/quadrant criteria used by `oi_gainers`/`short_covering`. `movers_up` sorts desc,
  `movers_down` sorts asc (most negative first).
- `open_eq_high` / `open_eq_low` — `open_0915 == day_high` / `== day_low` within
  `_OPEN_EQ_TOL = 0.005`, evaluated only over `oi_gainers + short_covering`. Both `day_high`
  and `day_low` come from the live Kite quote (`fno_tactical_service`), same substrate as
  the rest of the row.

## Tech Stack

- Backend: `app/services/fno_momentum_service.py` (pure service) →
  `app/routers/fno_momentum.py` (`/api/fno-momentum/scan`, `POST /invalidate`) →
  models in `app/models/fno_momentum.py`.
- Frontend: `src/pages/FnoMomentumPage.tsx`, `src/api/fnoMomentumApi.ts`,
  `src/types/fnoMomentum.ts`. Design system: `usePalette`/`useTokens`, hero gradient,
  `SectionHead` accents (indigo/violet/teal/amber), IBM Plex Mono numerics, green/red
  return semantics, shared `<Footer />`.

## Suggestions

- Add an OI-change % floor (e.g. ≥ 2%) on the OI Gainers bucket — near-zero OI drift
  currently qualifies if a momentum chip fires.
- Split OI Gainers by quadrant (LONG_BUILDUP vs SHORT_BUILDUP) with a toggle.
- Click-through: row → `/stock/:symbol` or the F&O Tactical option-chain drilldown.
- Persist an EOD snapshot of the two lists to `data_lake/derived/` for edge validation
  (do momentum-qualified OI gainers actually outperform next day?).
