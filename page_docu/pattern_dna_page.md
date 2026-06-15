# PatternDNAPage — `/pattern-dna`

## 1. What It Is Doing

Pattern detection, validation, and DNA scoring engine (~2,364 lines — the largest page). Answers: "Which chart patterns appear in NIFTY 50 stocks right now, what is their historical edge, and how reliable is that edge statistically?"

**Key modules**:

**PatternScanner** — multi-filter interface:
- Filters: stock selector, pattern type, category chips, stage chips, minimum confidence slider
- `ConfRing`: SVG confidence ring component — filled arc proportional to confidence %, colored by stage
- Displays: pattern name, symbol, category, stage, confidence, DNA score

**PatternScreener** — stock ranking per pattern:
- For each of 9 patterns: rank all 48 symbols by DNA Score (composite of SR, avg forward returns, occurrences)
- DNA Score = weighted composite of: success rate (SR), 1-week fwd return, 1-month fwd return, occurrences (frequency)

**ConfirmedFormingScreener** — intersection research:
- Finds stocks where the same pattern is currently forming AND has a strong historical DNA score
- "Run Scan" gate (slow — warns user) — NOT auto-loaded on mount

**ValidationSection** — 4-step validation suite:
1. **Occurrence check**: must have ≥ 10 occurrences in history
2. **OOS split**: train 3yr / test 2yr out-of-sample validation
3. **Decile/quintile analysis**: forward returns by confidence quintile — must show monotone improvement
4. **Confidence calibration**: stated confidence % must correlate with actual success rate

**PatternFormationChart**: Highcharts candlestick with:
- Formation zone: plotBand in amber
- Support/resistance lines: plotLine (green = support, red = resistance)
- Breakout target: plotLine (cyan dashed)

**MarketPatternHeatmap**: tile view of all symbols × all patterns, expandable with clickable symbol buttons.

**9 patterns** with category classification (Bullish Reversal, Bullish Continuation, Bearish Reversal, Bearish Continuation, Neutral).

**Stage colors**: Confirmed `#22c55e`, Breakout Watch `#f59e0b`, Maturing `#60a5fa`, Forming `#94a3b8`.

---

## 2. Optimization

- **2,364 lines is unsustainable** — split into at minimum: `PatternScanner.tsx`, `PatternScreener.tsx`, `ConfirmedFormingScreener.tsx`, `ValidationSection.tsx`, `PatternFormationChart.tsx`, `MarketPatternHeatmap.tsx`, `ConfRing.tsx` (in `src/components/pattern/`).
- `ConfRing` SVG component is defined inline — extract immediately. It is reusable across MarketDNA for any confidence visualization.
- Highcharts candlestick chart re-initializes on every pattern change. Cache the series data per symbol and only update plotBands/plotLines when the pattern changes.
- PatternScreener loads all 48 symbols × 9 patterns on render — this is 432 data points. Virtualize the pattern × symbol grid.
- ValidationSection decile analysis is computed on API call. Pre-compute and store in the Feature Store. The UI should only fetch and display, never trigger computation.
- MarketPatternHeatmap is an O(n×m) render — with 48 symbols × 9 patterns, this is 432 cells with hover state. Use CSS-only hover (no JS state per cell) to avoid 432 individual re-renders.

---

## 3. Lessons Learnt

- Pattern detection without validation is astrology. The 4-step ValidationSection is the most important architectural decision in this page — every pattern must survive OOS validation before appearing in the scanner.
- Confidence calibration (step 4) consistently reveals that pattern algorithms overstate confidence. Patterns claiming 80% confidence succeed 60% of the time in OOS. This should update the confidence display to show "calibrated confidence" not raw model output.
- The ConfirmedFormingScreener (current forming AND strong historical DNA) is the highest-value intersection research — it is both currently actionable and historically validated. This should be the default view, not hidden behind a "Run Scan" gate.
- Stage classification (Confirmed/Breakout Watch/Maturing/Forming) is more actionable than pattern name. A user cares more about "HDFC Bank has a confirmed Cup & Handle" than the pattern geometry.

---

## 4. Business Logic

**DNA Score formula** (per pattern per stock):
```
DNA_score = SR_weight × success_rate
          + ret1w_weight × avg_1w_return
          + ret1m_weight × avg_1m_return
          + freq_weight × normalized_frequency
```
Weights are validated against forward returns — higher weight for horizons that showed predictive power.

**Confidence ring** (ConfRing):
- `arc_length = confidence_pct / 100 × 2π × r`
- Stage determines color, confidence determines fill fraction

**OOS validation** (2-year holdout):
- Train: first 3 years of history
- Test: most recent 2 years
- Pattern passes if: OOS success rate ≥ 0.8 × in-sample success rate (no more than 20% degradation)

**Decile monotonicity**: sort occurrences by confidence quintile. Average forward return must be monotonically increasing from Q1 to Q5. If not monotone, the confidence score is not predictive and the pattern fails validation.

**Category color map**:
| Category | Color |
|---------|-------|
| Bullish Reversal | `#22c55e` |
| Bullish Continuation | `#4ade80` |
| Bearish Reversal | `#ef4444` |
| Bearish Continuation | `#f87171` |
| Neutral | `#f59e0b` |

---

## 5. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, Material UI |
| Charts | Highcharts with Highstock (candlestick, plotBands, plotLines) |
| API | `patternApi.scan()`, `patternApi.getStock(symbol, pattern)`, `patternApi.validate(pattern)` |
| Pattern detection | Backend: Polars rolling windows, rule-based detection |
| Validation | Backend: Statsmodels (OOS splits), NumPy (decile analysis) |
| DNA scoring | Backend: weighted composite, cached in Feature Store |
| Design | `usePalette()`, `useTokens()`, custom `CATEGORY_COLOR`, `STAGE_COLOR` maps |

---

## 6. Suggestions to Achieve the Objective

1. **Portfolio pattern concentration**: show how many stocks in a user's portfolio are simultaneously in "Breakout Watch" stage. High pattern concentration (5+ stocks forming the same pattern) is a systemic risk signal — position sizing should account for this correlation.
2. **Options strategy per pattern**: for each confirmed pattern with a directional edge (Bullish Continuation with DNA ≥ 70), suggest an options strategy matched to the pattern's typical payoff horizon. Cup & Handle breakouts tend to pay in 3–6 weeks → suggest 45-day bull call spread. Directly serves the options trading objective.
3. **Pattern radar (macro)**: aggregate which patterns are forming most frequently across NIFTY 50 right now. If 60% of stocks show bearish continuation patterns, that is a top-down macro signal even before checking index levels.
4. **Calibrated confidence display**: replace raw model confidence with calibrated confidence (from the calibration validation step). If the model says 80% and calibration shows it achieves 62% in OOS, show 62%. Honesty about accuracy is a competitive advantage.
5. **Historical analog overlay on chart**: when a Confirmed pattern appears, show the 3 most similar historical instances (by DTW distance) on the same chart as overlaid price paths. This gives the user a concrete visual sense of range of outcomes, not just a single expected return.
