# Pattern DNA Intelligence

## Mission

Transform chart patterns from subjective visual observations into a quantitative research system.

Traditional platforms answer:

> What pattern is forming?

Pattern DNA answers:

> Which patterns historically work best for this stock, under the current market regime, and what is the expected outcome?

---

# Detection Philosophy

## Never Force a Pattern

A pattern is only reported when ALL mandatory conditions pass.

If conditions are not met, the detector returns nothing — not a low-confidence result, nothing.

This is a hard rule. Forcing patterns is worse than missing them.

## Confidence Reflects Evidence

Confidence = (conditions_passed / total_conditions) × ceiling

Volume tier determines the ceiling:

| Volume Evidence | Confidence Ceiling |
|---|---|
| All volume conditions met | 90 |
| Some volume conditions met | 78 |
| No volume confirmation | 63 (research only) |

A pattern below 63 confidence is not shown to the user. It goes in logs.

## Volume Is a First-Class Input

Volume is not a bonus. For every pattern there are explicit volume conditions derived from classical TA literature (Murphy, Bulkowski).

Missing volume confirmation = capped confidence, not disqualification.

But a Bull Flag with no volume signature at all is extremely weak and should not be presented as a high-confidence setup.

## Explainability Is Mandatory

Every detection must be able to answer:
- Which specific price conditions passed?
- Which volume conditions passed?
- What is the breakout level?
- What is the measured-move target?
- What is the risk/reward at current price?

---

# Supported Patterns

## Bullish Reversal

### Double Bottom (W Pattern)

**Price Conditions (all mandatory):**
1. Two distinct troughs in last 150 bars
2. Trough separation: 15–80 bars (too close = noise, too far = stale)
3. Troughs within 3% of each other — alignment required
4. Neckline peak between troughs rises ≥5% above trough average — clear valley
5. Second trough within last 35 bars — recently formed
6. Current price within 8% below neckline — approaching breakout zone

**Volume Conditions:**
- V1: Second-trough volume ≤ 1.15× first-trough volume — selling exhaustion
- V2: Volume in rally from second trough > 85% of prior 20-bar average — accumulation building

**Target:** Neckline + (Neckline − Trough average)

**Reference:** Murphy, "Technical Analysis of Financial Markets," Chapter 5

---

### Inverse Head & Shoulders

**Price Conditions (all mandatory):**
1. Three troughs: left shoulder, head (deepest), right shoulder
2. Head at least 3% below both shoulders
3. Shoulders within 6% of each other
4. Neckline peaks within 5% of each other
5. Right shoulder within last 50 bars
6. Current price within 8% of neckline

**Volume Conditions:**
- V1: Right-shoulder volume ≥ left-shoulder volume — growing participation
- V2: Head volume ≥ left-shoulder volume — climactic selling at the low
- V3: Volume in rally from right shoulder > prior 20-bar average — demand

**Target:** Neckline + (Neckline − Head)

---

## Bearish Reversal

### Double Top (M Pattern)

Mirror of Double Bottom on highs.

**Price Conditions (all mandatory):**
1. Two distinct peaks in last 150 bars
2. Peak separation: 15–80 bars
3. Peaks within 3% of each other
4. Neckline trough at least 5% below peak average
5. Second peak within last 35 bars
6. Current price within 8% above neckline

**Volume Conditions:**
- V1: Second-peak volume ≤ 1.15× first-peak volume — buying exhaustion
- V2: Volume in decline from second peak > 85% of prior average — distribution

**Target:** Neckline − (Peak average − Neckline)

---

### Head & Shoulders

**Price Conditions (all mandatory):**
1. Three peaks: left shoulder, head (highest), right shoulder
2. Head exceeds both shoulders by ≥3%
3. Shoulders within 6% of each other
4. Neckline troughs within 5% of each other
5. Right shoulder within last 50 bars
6. Current price within 8% of neckline

**Volume Conditions:**
- V1: Left-shoulder volume > right-shoulder volume — classic distribution signature
- V2: Head volume ≤ left-shoulder volume — momentum waning at the top
- V3: Volume after right shoulder > prior 20-bar average — selling pressure

**Target:** Neckline − (Head − Neckline)

---

## Bullish Continuation

### Bull Flag

**Price Conditions (all mandatory):**
1. Pole: ≥12% return in 10–25 bars — strong directional move
2. Consolidation: 5–20 bars
3. Consolidation range: < 40% of pole height — tight, not a reversal
4. Flag slope: ≤ +1.5% per bar — not accelerating upward (that is a rising wedge)
5. Current price still within flag channel

**Volume Conditions:**
- V1: Pole average volume > 1.25× prior 20-bar average — momentum surge
- V2: Flag average volume < pole average volume — natural pullback, not distribution
- V3: Flag volume trend is declining — price coiling under lower volume

**Target:** Pole high + Pole height

**Note:** Bull Flag is the pattern most sensitive to volume. A flag with no volume contraction has low edge historically.

---

### Ascending Triangle

**Price Conditions (all mandatory):**
1. At least 3 touches of flat resistance — coefficient of variation < 2%
2. At least 3 higher lows — rising support
3. Pattern spans at least 20 bars
4. Current price in upper 40% of triangle width — coiling near resistance

**Volume Conditions:**
- V1: Volume declines through formation — classic coiling behaviour
- V2: Volume on resistance touches > volume on support touches — buying pressure at resistance

**Target:** Breakout level + Triangle height

---

## Bearish Continuation

### Bear Flag

Mirror of Bull Flag on the downside.

**Price Conditions (all mandatory):**
1. Pole: ≤ -12% return in 10–25 bars
2. Consolidation: 5–20 bars
3. Consolidation range: < 40% of pole height
4. Flag slope: ≥ -1.5% per bar (not accelerating downward)
5. Current price still within flag channel

**Volume Conditions:**
- V1: Pole average volume > 1.25× prior average — panic selling surge
- V2: Flag average volume < pole average volume — dead-cat-bounce exhaustion
- V3: Flag volume trend declining — bears resting before continuation

**Target:** Pole low − Pole height

---

### Descending Triangle

Mirror of Ascending Triangle on lows.

**Price Conditions (all mandatory):**
1. At least 3 touches of flat support — CV < 2%
2. At least 3 lower highs — declining resistance
3. Pattern spans at least 20 bars
4. Current price in lower 40% of triangle width

**Volume Conditions:**
- V1: Volume declines through formation
- V2: Volume on support tests ≥ volume on resistance tests — selling at support

**Target:** Breakdown level − Triangle height

---

## Neutral

### Rectangle (Trading Range)

**Price Conditions (all mandatory):**
1. At least 2 resistance touches within 3% of each other
2. At least 2 support touches within 3% of each other
3. Range height ≥ 6% — meaningful range, not noise
4. At least 2 oscillations between support and resistance (price visited both sides)
5. Pattern spans ≥ 15 bars
6. Current price inside the range

**Volume Conditions:**
- V1: Volume balanced between upper and lower half of formation — no directional bias yet
- V2: Volume rising as price nears range boundaries — anticipation of breakout

**Target:** Measured move = range height in direction of breakout

---

# Pattern Lifecycle

```
Forming         Price is building the structure; key levels not yet tested
    ↓
Maturing        Structure is clear; price within 10% of trigger level
    ↓
Breakout Watch  Price within 3% of trigger level; high alert
    ↓
Confirmed       Price has crossed the trigger level; pattern resolved
```

---

# Confidence Guide

| Range | Meaning |
|---|---|
| 85–90 | Strong structure + full volume confirmation. High quality. |
| 75–84 | Good structure + partial volume confirmation. Worthwhile. |
| 65–74 | Structure present, volume inconclusive. Research use only. |
| < 65 | Not shown to user. |

---

# Historical DNA (Pattern Genome)

For every stock, compute the historical success rate of each pattern using its full price history.

**Methodology:**
1. Slide a window through 5+ years of daily OHLCV
2. At each step (every 5 bars), check if the mandatory price conditions were met
3. Also check if the primary volume condition was met (keeps DNA consistent with live detection)
4. Record the 21-day and 63-day forward return at each qualified occurrence
5. Aggregate: success rate, average return, consistency, DNA score

**DNA Score formula:**
```
DNA Score = (success_rate × 0.7) + magnitude_bonus + consistency_bonus
```
- Magnitude bonus: min(20, |avg_21d_return| × 2)
- Consistency bonus: max(0, 10 − std(returns) × 0.5)
- Output: 0–100

**Minimum sample requirement:** 4 qualified occurrences. Below this the DNA is not shown.

---

# Screener Patterns (DNA-ranked)

The screener ranks stocks by their historical DNA score for a chosen pattern.

Supported patterns for DNA ranking:

- Double Bottom
- Double Top
- Bull Flag
- Bear Flag

(These four have the most historical occurrences across the NIFTY universe and produce statistically meaningful DNA scores.)

---

# Confirmed Forming Screener

A high-conviction cross-filter:

> Find stocks where the currently forming pattern is also the stock's historically strongest pattern.

Logic:
1. Run live detection on all stocks
2. For stocks with active patterns, compute their Pattern DNA
3. Match: forming pattern == best historical pattern
4. Rank by (DNA score, confidence) descending

This is not a prediction. It is a research flag: "this stock is doing the thing it has historically done well."

---

# Active Scanner

Scan all symbols and surface the highest-confidence patterns currently forming.

Filters available:
- Minimum confidence (default: 65)
- Pattern type
- Stage (Forming / Maturing / Breakout Watch)
- Category (Bullish Reversal / Bearish Reversal / Continuation / Neutral)

---

# What This Is Not

- Not a buy/sell signal generator
- Not a prediction engine
- Not a guarantee of outcome

Every detection is a structured observation backed by historical statistics. The user decides what to do with it.

---

# Future Patterns (Not Yet Implemented)

These patterns require additional algorithmic work before they meet the production standard:

| Pattern | Challenge |
|---|---|
| Cup & Handle | Requires curvature detection for U-shape, not just price levels |
| Symmetrical Triangle | Ambiguous direction; needs regime context to be useful |
| Rounded Bottom / Top | Curve fitting required; hard to define programmatically |
| Bull/Bear Pennant | Overlaps heavily with triangle; distinguishing criteria unclear |
| Triple Bottom / Top | Rare in daily data; sample sizes too small for DNA |

These will be added once a validation methodology is established for each.
