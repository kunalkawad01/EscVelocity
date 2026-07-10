# IV Smile Page — `/iv-smile`

Per-strike implied-volatility smile with Black-Scholes greeks and skew analytics for the front (nearest) options expiry.

## What It Does

Given a single F&O symbol, renders the volatility smile for the front expiry and the skew metrics that reveal *where the market is pricing fear*:

- **Skew snapshot**: Spot, ATM IV, 25-delta risk reversal (with plain-language skew interpretation), skew slope, put-wing IV, call-wing IV. Leads with an auto-generated plain-English skew summary sentence + tone chip (`skewSummary()`).
- **Strategy Lens** (`strategyLens()`): deterministic, rule-based research callout. Combines vol level (absolute IV buckets — *provisional* until IV-Rank history exists), skew direction/strength (RR), smile steepness (wings vs ATM), and DTE into a bias line + reasoning chips + candidate option structures, each citing its driver. Framed as *research, not advice* (platform charter). No LLM.
- **IV smile chart** (Highcharts spline): OTM-side smile IV per strike, overlaid with raw Call IV / Put IV scatter, a spot plot-line, a dashed skew-fit trendline (#1), violet 25Δ wing markers (#2), and shaded ±8–12% put/call wing bands (#3).
- **Strike greeks table**: per-strike moneyness, smile IV, call/put delta, gamma, vega, CE/PE OI. ATM row highlighted.
- **"How to read this page"**: a collapsible glossary (`GlossaryPanel`, closed by default) documenting each parameter's formula, significance, and how to read it — grouped as Volatility level · Skew · Greeks · Putting it together.

Symbol is chosen via an Autocomplete populated from `/api/stock/symbols`; the page fetches on mount (default `RELIANCE`) and on every symbol change.

## Optimization

- **Per-symbol day-keyed cache** (`_iv_smile_cache`) in `options_service` — first hit computes, subsequent hits are in-memory. Auto-clears when a newer options data-date appears (`_refresh_if_new_day`), so post-ingestion pages refresh without an explicit `/invalidate`.
- Endpoint is **on-demand, not prewarmed** — a single symbol's smile is one indexed DuckDB query (front expiry only) + pure-NumPy/Black-Scholes; ~90 ms cold.
- Greeks are computed with `math.erf` (no scipy) — cheap and dependency-light.
- Frontend fetches with an `AbortController`-style `cancelled` flag to drop stale responses on rapid symbol switches.

## Lessons Learnt

- **NSE IV feed carries garbage** — ~8% of IV values are >100 (up to ~500) on deep-OTM / illiquid strikes. All IV is filtered to a plausible band `[1, 150]%` via `_clean_iv` before it feeds the smile, greeks, or ATM IV. Never plot raw feed IV.
- **Smile convention = OTM side.** Below spot use put IV, above spot use call IV, blend at ATM. Mixing ITM/OTM IV of the same option produces a distorted curve.
- **Only 2 expiries and ~15 days of history exist** in the option-chain parquet as of build time — this page is a *point-in-time* smile (front expiry), NOT an IV-rank / term-structure page. IV rank vs history is blocked until the parquet accumulates months of data.
- `hcTheme.xAxis` has no `title` key — set axis-title `style` inline rather than spreading a nonexistent `hcTheme.xAxis.title.style`.

## Business Logic

- **25-delta risk reversal** `rr_25d = IV(25Δ put) − IV(25Δ call)`. Positive = put skew (downside fear); negative = call skew (upside chase). The 25Δ strikes are located from the computed greeks (closest call Δ to 0.25, put Δ to −0.25).
- **Skew slope** = OLS slope of `smile_iv` vs `moneyness` (IV points per +1% OTM), `np.polyfit` deg 1, needs ≥3 valid points.
- **Wing IVs** = mean smile IV within the 8–12% OTM band on each side.
- **Greeks**: Black-Scholes, `r = 6.5%` (India risk-free proxy), `T = max(DTE,1)/365`. Delta/gamma/vega/theta; theta and vega scaled per-day / per-1-vol-point. Deterministic (Principle 3).

## Tech Stack

- **Backend**: `app/services/options_service.py` → `get_iv_smile()`; router `app/routers/options.py` → `GET /api/options/{symbol}/iv-smile`, `POST .../iv-smile/invalidate`. Models in `app/models/options.py` (`IVSmileResponse`, `IVSmileStrike`).
- **Frontend**: `src/pages/IVSmilePage.tsx`; API `src/api/optionsApi.ts` (`getIVSmile`); types `src/types/options.ts`. Highcharts + highcharts-more, MUI, design-system hooks (`usePalette`/`useTokens`).
- **Data**: `options_chain` DuckDB view over `data_lake/raw/options/date=*/data.parquet`.

## IV-Rank Persistence (shipped)

- **Persisted series**: `data_lake/derived/iv_history/atm_iv.parquet` — one ATM-IV row per (symbol, date), rebuilt from `options_chain` whenever a new options date appears. ATM IV = mean cleaned CE+PE IV at the strike nearest spot.
- **Rebuild triggers**: startup prewarm (`warm_iv_history`), automatic on new-date detection (`_ensure_iv_history` inside `get_iv_smile`), and explicit `POST /api/options/iv-history/rebuild` (run after post-market options ingestion).
- **IV-Rank** = `(atm_iv − min) / (max − min) × 100` over trailing ≤252 days; **IV-percentile** = % of history days below today. Both `null` until `_IV_RANK_MIN_DAYS` (20) of history exist — today there are ~15 days, so they populate automatically in a few sessions.
- **Response fields**: `iv_rank`, `iv_percentile`, `iv_history_days`, `atm_iv_history[]`.
- **Strategy Lens graduation**: when `iv_rank` is available the lens grades vol by IV-Rank (cheap <25 / below-avg <50 / elevated <75 / rich ≥75) and drops the "provisional" caveat; otherwise it falls back to absolute IV bands + the caveat.

## Suggestions

1. **Add a term-structure strip** once ≥3 expiries are ingested (front vs next vs far ATM IV).
2. **IV-Rank sparkline** — render `atm_iv_history[]` as a mini Highcharts sparkline in the IV Rank tile (data already in payload).
3. **Realised-vs-implied** overlay (HV20 vs ATM IV) to flag rich/cheap vol.
4. **Rich/cheap per-strike shading** (smile IV vs a fitted SVI/quadratic) to surface mispriced strikes.
5. Expose greeks-based position tools (delta-hedge ratio, gamma/vega exposure) — greeks are first-class in the payload.
