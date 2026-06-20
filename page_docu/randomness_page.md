# RandomnessPage — `/randomness`

## What It Does

Decompose any NSE equity's historical return into three modules that expose how much of the
performance was skill, timing luck, and fragility to path:

1. **Luck vs Skill** — consistency (% positive months), rolling return coefficient of variation,
   and start-date outcome dispersion (1,000 random 2-year windows, seed 42).
   Luck Score (0–100): 0 = pure skill, 100 = pure luck.

2. **Return Concentration** — how many days explain the total return (RCR = top-10-day share).
   Waterfall showing return if best 1/5/10/20 days were missed.
   Concentration curve (cumulative % vs diagonal ideal).

3. **Fragility** — radar across 5 axes (concentration, DD recovery %, regime dep., path IQR,
   worst-period dep.). Monte Carlo 10,000 shuffles of daily return order → CAGR distribution
   with P10/P50/P90 markers. Bull vs Bear regime annualised returns (SMA-200 proxy).

The page also shows a **Verdict + Key Risk** banner summarising all three modules.

---

## Optimization

- API is on-demand: user selects symbol and clicks **Analyse** — no fetch on mount.
- Backend caches result in-process dict keyed `{symbol}:{date.today()}` — one Monte Carlo per stock per day.
- Monte Carlo is fully vectorised NumPy: `rng.integers(0, nd, size=(10_000, nd))` → single `np.prod` on axis=1. ~0.5–1s for 5-year history.
- Concentration curve pre-capped at 50 points to keep JSON small.

---

## Lessons Learnt

- Highcharts Options type does not allow `fillColor` on `plotOptions.line` (only on area/arearange).
  Use `marker.fillColor` for data point colour on polar/radar charts.
- `this.x` in Highcharts tooltip formatter is typed as `string | number` — cast with `(this.x as number)` before arithmetic.
- Duplicate keys in an object literal (`xAxis` defined twice in one Options object) are a TS error 1117.
  Always merge `plotLines` into the same `xAxis` definition.
- `Record<string, boolean>` is the correct pattern for toggling N independent panels from a single `useState`
  inside a `.map()` — avoids calling `useState` inside a loop.

---

## Business Logic

- **Luck Score formula**: `(start_date_sensitivity × 0.40) + (rolling_CV × 0.35) + (1 − consistency) × 0.25` → scaled 0–100.
  Lower = more skill-driven.
- **RCR (Return Concentration Ratio)**: `top-10 daily returns / sum of all daily returns × 100`.
  < 20% = healthy, 20–50% = moderate, > 50% = fragile.
- **Fragility Score**: weighted sum of worst-period dep. (0.20) + path IQR (0.20) + regime variance (0.20)
  + DD time dep. (0.15) + (1 − % shuffles positive) × 0.25. Scaled 0–100.
- **Verdict**: "Highly Believable" when luck_score < 30 and RCR < 30; "Luck-Driven" when both > 60.
- **Regime proxy**: SMA-200 computed with NumPy convolve on price array — no extra DB query.
  Bull days = price > SMA-200. Regime returns are cumulative (not annualised) over the full history.
- **Missing best days**: delete top-N indices from daily_rets array, then `np.prod(1 + remaining) - 1`.

---

## Tech Stack

**Backend**
- `app/models/randomness.py` — Pydantic v2 models: `LuckSkillResult`, `ConcentrationResult`,
  `FragilityResult`, `RandomnessReport`
- `app/services/randomness_service.py` — pure NumPy analytics; in-memory cache; DuckDB fetch via `get_connection()`
- `app/routers/randomness.py` — `GET /api/randomness/{symbol}`, `POST /api/randomness/{symbol}/invalidate`
- Registered in `app/main.py` — no startup prewarm (on-demand only)

**Frontend**
- `src/types/randomness.ts` — TypeScript interfaces mirroring all Pydantic models
- `src/api/randomnessApi.ts` — `getReport(symbol)`, `invalidate(symbol)`
- `src/pages/RandomnessPage.tsx` — ~330 lines; 4 chart sub-components:
  `CurvChart` (Highcharts line), `WaterfallChart` (column), `RadarChart` (polar line),
  `MCChart` (column with plotLines for P10/P50/P90)
- Uses `useSymbols()` for the symbol dropdown
- `Navbar.tsx` — `{ to: '/randomness', label: 'Randomness' }` added
- `App.tsx` — `<Route path="/randomness" element={<RandomnessPage />} />`

---

## Suggestions

1. **Add symbol comparison** — allow running two symbols side-by-side and diff the scores.
   Useful for "is RELIANCE more skill-driven than TCS?"
2. **Annualise regime returns** — current bull/bear returns are cumulative totals, which depend on
   how long each regime lasted. Annualised CAGR per regime is more comparable across stocks.
3. **Rolling luck score chart** — plot luck_score on a sliding 2-year window over the full history
   to show whether the stock has become more or less skill-driven recently.
4. **Sector percentile ranks** — where does this stock's Luck/Fragility score rank within its sector?
   Requires a batch run over all symbols and sector mapping.
5. **Cache warming on startup** — pre-compute for NIFTY 50 stocks at startup so the first user
   request is always instant. Use the parquet-first pattern from `stock_health_service`.
