# DeliveryPage — `/delivery`

## 1. What It Is Doing

NSE delivery data intelligence module (~1,664 lines). Loads on mount. Transforms NSE bhavcopy delivery percentage data into graded trading signals with forward-return validation.

The page answers: "Is the volume and delivery footprint for this stock behaviorally significant, and what has that pattern historically led to?"

**Six delivery signals** are computed:
| Signal | Condition |
|--------|-----------|
| Accumulation | Vol > 2× avg AND Del ≥ 65% AND up close |
| Distribution | Vol > 2× avg AND Del ≥ 65% AND down close |
| High Delivery Up | Del ≥ 70% AND up close |
| High Delivery Down | Del ≥ 70% AND down close |
| Delivery Spike | del_ratio ≥ 1.5× |
| Vol+Del Spike | vol_ratio ≥ 1.5× AND del_ratio ≥ 1.5× |

**Signal grading** (based on historical forward returns):
| Grade | Win Rate | Expected Value | Min Occurrences |
|-------|----------|---------------|-----------------|
| A+ | ≥ 65% | ≥ 3% | ≥ 15 |
| A | ≥ 60% | ≥ 2% | ≥ 10 |
| B | ≥ 55% | ≥ 1% | ≥ 8 |
| C | ≥ 50% | ≥ 0% | ≥ 5 |
| D | < 50% | — | — |

**Intent panel**: classifies current setup as one of Buy / Short / Hold / Square Long / Square Short / Explore based on regime + signal combination.

**SignalInterpretation**: 4 analytical sections — Signal Quality, Speed of Payoff (which horizon 1d/1w/1m/1y pays best), Market Regime Effect (how regime≥60 vs <60 changes win rates), Risk Profile.

**Charts**: Highcharts — DeliverySparkline (column + spline), VolumeSparkline (dual Y-axis), DistributionHistogram, TimelineChart (scatter across 4 horizons).

---

## 2. Optimization

- Page is 1,664 lines — should be split into: `DeliveryScanner.tsx`, `SignalCard.tsx`, `SignalInterpretation.tsx`, `DeliveryCharts.tsx`. Monolithic file is hard to maintain.
- All chart components are defined inline — extract to `src/components/delivery/`.
- No virtualization on the signal table — when all 48 symbols are shown, DOM becomes heavy.
- Highcharts instances are not destroyed on symbol change → memory leak over long sessions. Add `useEffect` cleanup calling `chart.destroy()`.
- The six-signal computation runs on every API call. These signals should be pre-computed in the Feature Store and cached in Redis (1-hour TTL) — the API should return pre-graded results.
- Timeline chart for 4 horizons (1d/1w/1m/1y) requires 4 separate forward-return computations — batch these into one backend call.

---

## 3. Lessons Learnt

- Delivery percentage alone is noise. The signal requires coincident volume spike (vol_ratio) to be meaningful. This conjunction criterion is the key to reducing false positives.
- Forward return validation at 4 horizons (1d/1w/1m/1y) revealed that Accumulation signals with A+ grade pay off primarily at 1-week horizon — the 1-day horizon is too noisy from intraday reversals.
- Market regime conditioning is essential: the same signal in regime ≥ 60 (trending market) has fundamentally different win rates than regime < 60. Showing regime-unconditioned stats without this split is misleading.
- Edge score formula `edge_score = (win_rate/100) × max(EV, 0) × frequency` is correct but frequency needs to be penalized — a signal that fires once a year with 80% WR is not practically useful.

---

## 4. Business Logic

**Edge score formula:**
```
edge_score = (win_rate / 100) × max(EV, 0) × frequency
frequency = occurrences / total_bars × 100
```

**Regime conditioning:**
- Regime ≥ 60 = trend market → bullish signals more reliable
- Regime < 60 = weak/bear market → bearish signals (Distribution, High Delivery Down) more reliable

**Intent mapping** (signal + regime → intent):
- Accumulation A/A+ + regime ≥ 60 → BUY
- Distribution A/A+ + regime < 50 → SHORT
- High Delivery Up + regime 40–60 → EXPLORE (conflicted regime)
- Delivery Spike alone → EXPLORE (no directional confirmation)

**Grading frequency threshold**: signals with < 5 occurrences receive grade D regardless of win rate (insufficient sample size for inference).

---

## 5. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, Material UI, Highcharts |
| API | `deliveryApi.getSymbol(symbol)`, `deliveryApi.getScan()` |
| Charts | Highcharts: column, spline, scatter, dual Y-axis |
| State | `useState`, parallel fetch on symbol load |
| Design | `usePalette()`, `useTokens()` — CARD/TH/TD tokens |
| Signal Logic | Backend: Python, Polars, DuckDB (NSE bhavcopy raw data) |

---

## 6. Suggestions to Achieve the Objective

1. **Portfolio construction integration**: signals graded A/A+ with regime ≥ 60 should be directly linkable to the Portfolio Engine (Phase 6). A one-click "Add to watchlist for portfolio construction" button would connect delivery edge to position sizing.
2. **Options sizing suggestion**: for Accumulation A+ signals, show a recommended options strategy — e.g., buy ATM call, sell OTM call (bull call spread) with payoff matched to the 1-week forward return distribution. This connects delivery intelligence to the options objective.
3. **Sector-level delivery breadth**: when ≥ 50% of a sector shows Accumulation signals in the same week, that is a sector-rotation signal. Build a sector delivery heatmap on top of the existing per-symbol signals.
4. **Automated signal log**: persist every A/A+ signal with timestamp, stock, regime score, and horizon returns as they resolve. This builds a live validation dataset that self-updates without requiring manual research cycles.
5. **Delivery + Cointegration overlay**: when a cointegrated pair shows diverging delivery signals (Accumulation on A, Distribution on B), the spread is being confirmed by smart money. This is a high-conviction pairs trade entry.
