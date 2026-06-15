# QuantStrategiesPage — `/quant-strategies`

## 1. What It Is Doing

Four-module quantitative strategy engine (~881 lines). All four modules are triggered by a single `quantStrategiesApi.scan()` call (explicit "Run Scan" gate — not auto-loaded). Returns data for all four strategies simultaneously.

**The four modules**:

### 1. MomentumSection
- **Factor**: 12-1 month skip-one return (excludes last month to avoid short-term reversal)
- **Output**: stocks ranked into quintiles Q1–Q5 (Q1 = highest momentum, Q5 = lowest/reversal)
- **Filters**: sector filter, show by quintile
- **Options strategy per stock**: matched to momentum strength (Q1 = long calls, Q5 = puts or avoid)

### 2. MeanReversionSection
- **Factor**: composite Bollinger Z-score + RSI deviation from 50
- **Output**: bidirectional score bar from center (right = overbought candidate, left = oversold candidate)
- **Signal**: stocks most extended from mean = mean reversion candidates

### 3. VolRankSection
- **Factor**: HV20 percentile vs 252-day window
- **Signal**: HV rank ≥ 70 → sell premium (IV likely inflated vs realized); HV rank ≤ 30 → buy premium (vol cheap)
- **Options logic**: directly maps vol rank to options premium strategy without directional assumption

### 4. SectorRotationSection
- **Factor**: Relative Rotation Graph (RRG) quadrant placement
- **Quadrants**: Leading (high RS, improving), Weakening (high RS, declining), Improving (low RS, gaining), Lagging (low RS, declining)
- **Sector table**: RS vs NIFTY benchmark, RS trend direction, current quadrant
- **`PHASE_DESC` map**: Leading='Strong RS and improving — stay long', Improving='Gaining momentum — accumulate', Weakening='Momentum fading — reduce exposure', Lagging='Underperforming — avoid or short'

**`SummaryStrip`**: top/bottom color-coded stock cards per section — Q1/overbought in green, Q5/oversold in red.

---

## 2. Optimization

- All four modules load in a single API call — correct architecture. But the scan takes 20–40s. Pre-compute nightly; the "Run Scan" button should only refresh the cache if data is stale (> 24h old), not recompute from scratch every time.
- `SummaryStrip` renders top 5 + bottom 5 per section = 20 mini-cards. These are individually created with `map()` — no virtualization needed at this scale, but avoid re-rendering all 20 on any state change.
- MeanReversionSection bidirectional bar is custom-built. Consider replacing with a standard `LinearProgress` with center origin (like MarkovOptionsPage does) for consistency.
- SectorRotationSection table has no sort controls. Add column-sort on RS score and quadrant name.
- Options strategy per stock in MomentumSection is derived client-side from quintile number. Move this logic server-side (MCP tool) so the AI agent can access the same recommendation.

---

## 3. Lessons Learnt

- The "skip-one" in momentum (12-1 months, excluding last month) is not optional — it is academically established that including the most recent month introduces reversal bias that destroys the momentum premium. Always use 12-1 not 12-0.
- VolRank is the cleanest bridge between quant factors and options strategy. It requires no directional view — only a vol-level view — which aligns with the options intelligence objective better than momentum or mean reversion.
- SectorRotationSection (RRG) is visually intuitive but computationally intensive. The RRG calculation (relative RS and its rate of change) should be cached at sector level, not recomputed per stock.
- The `PHASE_DESC` map is a hardcoded interpretation layer. This is a business logic decision, not a UI decision — it should live in the backend service, not the frontend component file.

---

## 4. Business Logic

**Momentum factor**: 
```
momentum_score = cumulative_return(t-12months, t-1month)
```

**Mean reversion composite**:
```
mr_score = 0.5 × bb_z_score + 0.5 × (rsi - 50) / 50
bb_z_score = (price - bb_mean) / bb_std
```
High positive = overbought; high negative = oversold.

**Vol rank**:
```
vol_rank = percentile(HV20, HV_window_252d) × 100
HV20 = realized vol over last 20 trading days (annualized)
```

**RRG quadrant** (Relative Rotation Graph):
```
rs_ratio = stock_cumret(52w) / benchmark_cumret(52w)  [smoothed]
rs_momentum = rate_of_change(rs_ratio, 1month)
quadrant = (rs_ratio > 100, rs_momentum > 0) → Leading
           (rs_ratio > 100, rs_momentum < 0) → Weakening
           (rs_ratio < 100, rs_momentum > 0) → Improving
           (rs_ratio < 100, rs_momentum < 0) → Lagging
```

**Options strategy mapping** (MomentumSection):
| Quintile | Suggested Options Strategy |
|---------|--------------------------|
| Q1 (top momentum) | Long calls / bull call spread |
| Q2 | Long calls — selective |
| Q3 | Neutral — iron condor |
| Q4 | Bear put spread — selective |
| Q5 (bottom) | Long puts / avoid long calls |

---

## 5. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, Material UI, LinearProgress |
| API | `quantStrategiesApi.scan()` → single POST `/api/quant/scan` |
| Algorithm | Backend: Polars (factor computation), Statsmodels (RS ratio), NumPy (percentile) |
| Charts | None (text-based quintile / bar display) |
| State | Single API call result → 4 section data objects |
| Design | `usePalette()`, CARD/TH/TD/TabBar tokens |

---

## 6. Suggestions to Achieve the Objective

1. **Factor combination portfolio**: combine the 4 factors into a composite "Quant Score" using a validation-tested weight (momentum 40%, RS 30%, vol rank 20%, mean reversion 10% as a starting point). The top-quintile composite score becomes a portfolio construction input. This is the direct link from this page to the portfolio objective.
2. **Interactive RRG chart**: replace the SectorRotationSection table with a real 2D scatter RRG chart (RS ratio on X, RS momentum on Y, quadrant backgrounds). This is the canonical visualization for sector rotation and far more intuitive than a table. Highcharts supports this natively with scatter + quadrant plotBands.
3. **Factor timing overlay**: show each factor's hit rate by market regime. Momentum works best in trending markets (regime ≥ 65). Mean reversion works best in sideways markets (40–60). VolRank is regime-neutral. Regime-conditioning the factor recommendations dramatically improves signal quality.
4. **Options strategy batch builder**: for the top Q1 momentum stocks with HV rank ≤ 30 (cheap vol + strong momentum), auto-generate a bull call spread structure with strikes, expiry, and estimated cost. This integrates the momentum and vol rank factors into a concrete options trade — directly serving the options trading objective.
5. **Macro factor integration**: add a fifth module — **Macro Factor** — showing how NIFTY 50 sector momentum correlates with FII flow, 10Y bond yield trend, and USD/INR direction. Sector rotation without macro context misses the structural forces driving rotation. This builds toward the macro research objective.
