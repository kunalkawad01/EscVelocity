# Pattern DNA Validation — Methodology & Results

## Overview

This document describes the four-step validation framework applied to the Pattern DNA engine.
A pattern earns "Validated" status only after passing all three measurable tests (Steps 2–4).
Step 1 is a data quality gate applied universally.

---

## Step 1 — Minimum Sample Threshold

**What:** Any pattern–stock DNA score requires at least **12 qualified historical occurrences**.

**Why:** A DNA score built on 3–5 observations has no statistical meaning. The standard error of
a proportion at n=5 is ~±22 percentage points, which is larger than the signal being measured.
At n=12 the standard error drops to ~±14pp — still not ideal, but acceptable for a research flag.

**Implementation:** `_aggregate()` in `pattern_service.py`, line: `if len(valid) < 12: return None`

**Effect:** Patterns with sparse history (Head & Shoulders, Inverse H&S, Rectangle on shorter
histories) will return no DNA score rather than a misleading one.

---

## Step 2 — Out-of-Sample (OOS) Split

### Design

| Period        | Bars | Approx Years |
|---------------|------|--------------|
| In-sample (IS)  | 756  | 3.0          |
| Out-of-sample (OOS) | 504 | 2.0      |
| Required minimum | 1324 | 5.25     |

Only stocks with at least 5.25 years (1324 bars including 64 for the final forward-return window)
are included.

### Method

1. Slice each stock's full OHLCV into IS and OOS portions.
2. Run the production historical scanners on the IS slice. Record 21-day forward returns.
3. Run the same scanners on the OOS slice. Record 21-day forward returns.
4. Compute success rate and average return for each period independently.

### Pass Criterion

> OOS success rate degrades < 20% relative to IS success rate.

Formula: `degradation = (IS_SR - OOS_SR) / IS_SR × 100`

If degradation ≥ 20%, the pattern's historical edge does not generalise. It may be:
- Overfitted to the specific IS regime
- Not statistically robust at the sample sizes available

### Interpretation

- **Passes:** Pattern showed similar edge in a forward period it never "trained on"
- **Fails:** Pattern was stronger historically than in recent data — use with caution
- **Insufficient:** Not enough OOS detections to compute a meaningful rate

---

## Step 3 — Decile (Quintile) Analysis

### Design

Applies to: **Bull Flag** and **Bear Flag** (the patterns with the most historical occurrences,
giving enough cross-sectional data to rank stocks meaningfully).

With 48 NIFTY symbols, strict deciles (groups of ~5) are too small. We use **quintiles**
(groups of ~10) to ensure each group has enough observations.

### Method

1. For each stock, compute its IS DNA score for the pattern.
2. Rank all stocks by IS DNA score, descending.
3. Split into 5 quintile groups (Q1 = highest IS DNA score, Q5 = lowest).
4. For each group, collect all OOS detections and compute the average 21-day forward return.

### Pass Criterion

> Q1 (best IS DNA) average OOS return must exceed Q5 (worst IS DNA) by ≥ 2 percentage points,
> and the ordering must be monotonically declining from Q1 to Q5.

### Interpretation

- **Passes:** Stocks that "know" the pattern historically (high IS DNA) also show better
  performance in the OOS period. The DNA score has predictive cross-sectional value.
- **Fails:** High-DNA and low-DNA stocks perform similarly OOS — the DNA score is not a useful
  discriminator.
- **Monotonic = True but spread < 2%:** Marginal — borderline, not a strong result.

---

## Step 4 — Confidence Calibration

### Design

The detection engine assigns a confidence score based on how many volume conditions pass.
This step checks whether that confidence score is *calibrated* — i.e., does higher confidence
actually correlate with a higher success rate?

### Volume Confidence Bins

| Bin | Volume Conditions Met | Description |
|---|---|---|
| None (0 vol) | 0 | Price structure only, no volume confirmation |
| Partial (1 vol) | 1 | One volume condition confirmed |
| Full (2+ vol) | ≥2 | All or most volume conditions confirmed |

### Method

1. For each pattern, run a **calibration scanner** over the full price history of all stocks.
2. The calibration scanner records all price-valid detections (not filtering on volume).
3. For each detection, record: (a) how many volume conditions passed, (b) the 21-day forward return.
4. Group detections into the three bins above.
5. Compute success rate per bin.

### Pass Criterion

> Success rate must be monotonically increasing from "None" → "Partial" → "Full" bins,
> AND the spread between Full and None bins must be ≥ 5 percentage points.

### Interpretation

- **Passes:** Volume confirmation adds real predictive value. The confidence ceiling system
  (90 for Full vol, 78 for Partial, 63 for None) is justified.
- **Fails:** Volume adds no value — the confidence ceiling may be misleading the user into
  thinking higher-confidence detections are more reliable when they aren't.

---

## Verdict Classification

| Verdict | Condition |
|---|---|
| VALIDATED | All applicable tests pass |
| PARTIAL | At least one test passes, at least one fails |
| UNVALIDATED | All applicable tests fail |
| INSUFFICIENT_DATA | Not enough detections for any test to run meaningfully |

---

## Constants

| Parameter | Value | Rationale |
|---|---|---|
| IS_BARS | 756 | 3 trading years |
| OOS_BARS | 504 | 2 trading years |
| MIN_HISTORY | 1324 | IS + OOS + 64 bars for final fwd-return window |
| MIN_OCC (production) | 12 | Minimum for any DNA score |
| MIN_OCC (IS decile) | 6 | Relaxed for shorter IS period in decile analysis |
| OOS degradation threshold | 20% | Industry standard for walk-forward tests |
| Decile spread threshold | 2% | Minimum meaningful cross-sectional edge |
| Calibration spread threshold | 5pp | Minimum volume confirmation premium |

---

## Patterns Covered by Validation

| Pattern | Step 2 OOS | Step 3 Decile | Step 4 Calibration |
|---|---|---|---|
| Double Bottom | ✓ | — | ✓ |
| Double Top | ✓ | — | ✓ |
| Bull Flag | ✓ | ✓ | ✓ |
| Bear Flag | ✓ | ✓ | ✓ |
| Head & Shoulders | — | — | — |
| Inverse H&S | — | — | — |
| Ascending Triangle | — | — | — |
| Descending Triangle | — | — | — |
| Rectangle | — | — | — |

The 5 complex patterns are not validated in the current suite because they produce too few
historical occurrences per stock (often 0–4 over 5 years) to compute statistically meaningful
rates. They are currently shown in the Pattern Genome with appropriate caveats. A dedicated
validation suite for these patterns is future work.

---

## Limitations

1. **Small universe:** 48 NIFTY 50 symbols is a small cross-sectional sample. Results may not
   generalise beyond large-cap Indian equities.

2. **Single look-ahead period:** Validation uses 21-day forward returns. Some patterns may have
   edge at different horizons (5-day breakout confirmation, 63-day trend continuation).

3. **No transaction costs:** Forward returns are raw, not adjusted for brokerage or slippage.
   Patterns with smaller average returns may not be profitable after costs.

4. **Regime sensitivity:** The IS period and OOS period may not cover the same market regimes.
   A pattern that works in a bull market IS period may fail in a sideways/bear OOS period for
   structural reasons, not because the signal is noise.

5. **Threshold calibration:** The 12-occurrence minimum, 20% degradation threshold, and 2%
   decile spread are reasonable priors but have not themselves been optimised. A more rigorous
   approach would use bootstrap confidence intervals.

---

## Files

| File | Purpose |
|---|---|
| `app/services/validation_service.py` | All computation logic |
| `app/models/validation.py` | Pydantic response models |
| `app/routers/patterns.py` | `GET /api/patterns/validation` endpoint |
| `src/types/validation.ts` | TypeScript interfaces |
| `src/api/patternApi.ts` | `getValidation()` API call |
| `src/pages/PatternDNAPage.tsx` | ValidationSection component |

---

## API

```
GET /api/patterns/validation
```

Returns a `ValidationReport` JSON object. Results are cached in memory after the first call.

Expected cold-start time: **60–180 seconds** (depends on number of symbols and server load).

```
GET /api/patterns/validation/invalidate
```

Clears the cache. The next call to `/validation` will re-run from scratch.
