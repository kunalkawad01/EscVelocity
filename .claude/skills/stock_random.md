---
name: marketdna:randomness-intelligence
description: >
  Use this skill when the user asks to "analyze how lucky this stock was", "how much of
  the return was skill vs luck", "check if this performance is repeatable", "show return
  concentration", "how many best days did this stock need", "how fragile is this stock's
  history", "is this edge real or accidental", "analyze randomness in returns",
  "how believable is this return", or any request involving luck/skill decomposition,
  return concentration analysis, or fragility scoring for Indian equity instruments.
metadata:
  version: "1.1.0"
  platform: NSE/BSE
  depends_on: historical OHLC price data (min 3 years)
  storage: DuckDB (marketdna.db)
---

# MarketDNA – Randomness Intelligence Engine

Most stock dashboards answer: _"How much did the stock return?"_

This skill answers: _"How believable was that return?"_

The goal is not prediction. The goal is understanding whether a stock's historical performance reflects a repeatable edge or an accidental cluster of lucky days.

---

## Philosophy

A stock with:

- 25% CAGR + low concentration + high consistency + low fragility

…is often superior to:

- 50% CAGR + extreme concentration + high fragility + luck-driven performance

Sustainable wealth creation comes from **repeatable edges**, not isolated outcomes. This engine exposes the difference.

---

## Workflow

1. Accept the stock symbol and date range from the user.
2. Query DuckDB (`ohlc_daily` table) for pre-ingested OHLC data; fetch from Kite Connect only on cache miss.
3. Run all three modules sequentially: Luck/Skill → Concentration → Fragility.
4. Persist intermediate results to DuckDB (`randomness_scores` table) for reuse across sessions.
5. Compute composite scores and output the MarketDNA Insight summary with visual dashboards.

---

## Module 1: Luck vs Skill Score

### Objective

Separate repeatable performance from random outcomes.

### Metrics

#### 1.1 Consistency Score

Frequency of positive periods across rolling windows.

| Stock | CAGR | Positive Months | Interpretation |
| ----- | ---- | --------------- | -------------- |
| A     | 25%  | 88%             | Higher skill   |
| B     | 25%  | 52%             | More luck      |

Compute for: daily, weekly, monthly, quarterly periods.

#### 1.2 Rolling Return Stability

Compute rolling returns at 1M, 3M, 6M, 12M windows.

For each window measure:

- Mean return
- Median return
- Standard deviation of return
- Coefficient of Variation (CV = σ / μ)

**Interpretation:** Low CV across windows → stable repeatable edge.

#### 1.3 Outcome Dispersion (Start-Date Sensitivity)

Simulate returns for 1000 random start dates within the period.

Measure:

- Distribution of terminal returns
- Inter-quartile range (IQR)
- % of start dates with positive outcome

**Interpretation:**

- Low dispersion → skill
- High dispersion → luck (start-date dependent)

#### 1.4 MarketDNA Luck Score

```
Luck Score = weighted_average(
  start_date_sensitivity * 0.40,
  rolling_return_cv * 0.35,
  1 - consistency_score * 0.25
) * 100
```

| Score  | Interpretation |
| ------ | -------------- |
| 0–30   | Mostly Skill   |
| 30–60  | Mixed          |
| 60–100 | Mostly Luck    |

---

## Module 2: Return Concentration

### Objective

Determine whether gains come from many days or a handful of lucky events.

### Metrics

#### 2.1 Top-Day Contribution

Compute cumulative return contribution from:

- Top 1, 5, 10, 20 days (by single-day return)

Express as % of total period return.

**Example:**
| Metric | Value |
|---------------|-------|
| Total Return | 40% |
| Top 5 Days | 32% |
| Concentration | 80% |

#### 2.2 Return Concentration Ratio (RCR)

```
RCR = Contribution of Top N Days / Total Period Return
```

| RCR    | Interpretation |
| ------ | -------------- |
| < 20%  | Healthy        |
| 20–50% | Moderate       |
| > 50%  | Fragile        |

#### 2.3 Missing Best Days Analysis

Simulate what the return would have been if the investor missed:

- Best 1 day
- Best 5 days
- Best 10 days
- Best 20 days

Output as a waterfall showing return degradation.

#### 2.4 Concentration Heatmap

Calendar-style heatmap marking days contributing the most to total return. Visually clusters extreme-gain events.

---

## Module 3: Fragility Metrics

### Objective

Measure how easily the performance breaks under different conditions.

### Metrics

#### 3.1 Worst Period Dependence

What % of total return came from one exceptional regime?

```
Worst Period Dependence = Max Single Period Return / Total Period Return
```

Example: If COVID recovery (130%) explains most of a 200% total return → fragile.

#### 3.2 Drawdown Recovery Dependence

What % of total return comes purely from recovering prior losses?

A stock that spends more than 30% of its return budget recovering drawdowns is fragile.

#### 3.3 Return Path Sensitivity (Monte Carlo)

1. Collect daily returns for the period.
2. Randomly shuffle the sequence 10,000 times.
3. Re-compute CAGR and max drawdown for each shuffle.

**Output:**

- Distribution of terminal wealth across shuffles
- P10 / P50 / P90 wealth outcomes
- % of shuffles with CAGR > 0

**Interpretation:** If shuffled returns produce wildly different outcomes → original performance is path-dependent, not repeatable.

#### 3.4 Regime Dependence

Break returns by market regime:

| Regime   | Return |
| -------- | ------ |
| Bull     | +180%  |
| Bear     | -65%   |
| Sideways | +3%    |

A stock that only works in one regime is fragile for all others. Cross-check against MarketDNA's existing regime classifier output.

#### 3.5 Edge Persistence Score

Rolling 12-month alpha vs Nifty 50 benchmark.

Count:

- Periods of outperformance vs underperformance
- Streak lengths (max consecutive outperformance)

```
Edge Persistence = (Outperforming periods / Total periods) × 100
```

#### 3.6 Fragility Score

```
Fragility Score = weighted_average(
  RCR (concentration) * 0.25,
  worst_period_dependence * 0.20,
  path_sensitivity_iqr * 0.20,
  regime_dependence_variance * 0.20,
  drawdown_recovery_dependence * 0.15
) * 100
```

| Score  | Interpretation |
| ------ | -------------- |
| 0–30   | Robust         |
| 30–60  | Moderate risk  |
| 60–100 | Fragile        |

---

## Output Format

### Composite MarketDNA Scorecard

```
MARKETDNA RANDOMNESS INTELLIGENCE REPORT
Stock: [SYMBOL] | Period: [START] to [END]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

LUCK vs SKILL
  Luck Score:           [0–100]  → [Mostly Skill / Mixed / Mostly Luck]
  Consistency Score:    [X]% positive months
  Outcome Dispersion:   [Low / Medium / High]
  Rolling Return CV:    [X]%

RETURN CONCENTRATION
  Top 5 Day Contribution: [X]% of total return
  RCR:                    [X]% → [Healthy / Moderate / Fragile]
  Missing Best 10 Days:   Return drops to [X]%

FRAGILITY
  Fragility Score:        [0–100] → [Robust / Moderate / Fragile]
  Regime Dependence:      [dominant regime driving returns]
  Path Sensitivity:       P10=[X]% | P50=[X]% | P90=[X]% CAGR
  Edge Persistence:       [X]% of 12M periods outperformed Nifty

FINAL VERDICT
  This stock's [X]% CAGR is [Highly Believable / Moderately Believable / Luck-Driven].
  Key risk: [top fragility factor identified].
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Visualizations

### Dashboard 1: Luck vs Skill Cards

Four metric cards:

- Luck Score (0–100 gauge)
- Consistency Score (% bar)
- Repeatability Score
- Outcome Dispersion (histogram)

### Dashboard 2: Return Concentration Curve

- X-axis: Days ranked by return contribution (top → bottom)
- Y-axis: Cumulative % of total return
- Ideal curve = diagonal line; steep early curve = dangerous concentration

### Dashboard 3: Missing Best Days Waterfall

Bar chart showing:

- Actual return
- Return minus best 1, 5, 10, 20 days
- Color coded: green (positive) → red (negative)

### Dashboard 4: Fragility Radar

Five-axis radar chart:

1. Concentration (RCR)
2. Drawdown Dependence
3. Regime Dependence
4. Path Dependence
5. Recovery Dependence

---

## DuckDB Storage & Optimization

### Why DuckDB

All intermediate computations and ingested OHLC data are persisted in a local DuckDB file (`marketdna.db`). This enables:

- Sub-millisecond re-queries on already-ingested tickers
- Vectorized columnar aggregations (rolling windows, Monte Carlo pivots) without pandas overhead
- Zero network round-trips for repeat analysis on the same symbol/date range

### Schema

```sql
-- Core price store
CREATE TABLE IF NOT EXISTS ohlc_daily (
    symbol      VARCHAR NOT NULL,
    date        DATE    NOT NULL,
    open        DOUBLE,
    high        DOUBLE,
    low         DOUBLE,
    close       DOUBLE,
    volume      BIGINT,
    daily_return DOUBLE GENERATED ALWAYS AS (close / LAG(close) OVER (PARTITION BY symbol ORDER BY date) - 1) VIRTUAL,
    PRIMARY KEY (symbol, date)
);

-- Cached module outputs — avoid recomputing for same symbol+period
CREATE TABLE IF NOT EXISTS randomness_scores (
    symbol          VARCHAR NOT NULL,
    period_start    DATE    NOT NULL,
    period_end      DATE    NOT NULL,
    luck_score      DOUBLE,
    rcr_pct         DOUBLE,
    fragility_score DOUBLE,
    edge_persistence DOUBLE,
    computed_at     TIMESTAMP DEFAULT now(),
    PRIMARY KEY (symbol, period_start, period_end)
);
```

### Optimization Patterns Applied

#### 1. Cache-first reads

Before any Kite Connect API call, check `ohlc_daily`:

```python
cached = con.execute("""
    SELECT COUNT(*) FROM ohlc_daily
    WHERE symbol = ? AND date BETWEEN ? AND ?
""", [symbol, start, end]).fetchone()[0]

if cached < expected_trading_days * 0.98:   # allow 2% gap tolerance
    fetch_from_kite_and_insert(symbol, start, end)
```

#### 2. Pushdown aggregations into DuckDB

Compute rolling stats and top-day rankings directly in SQL — avoid pulling raw rows into Python:

```sql
-- Rolling 21-day return mean and CV (Module 1)
SELECT date, symbol,
    AVG(daily_return) OVER w  AS roll_mean,
    STDDEV(daily_return) OVER w / NULLIF(AVG(daily_return) OVER w, 0) AS roll_cv
FROM ohlc_daily
WHERE symbol = ? AND date BETWEEN ? AND ?
WINDOW w AS (PARTITION BY symbol ORDER BY date ROWS BETWEEN 20 PRECEDING AND CURRENT ROW);

-- Top N daily return contributors (Module 2)
SELECT date, daily_return,
    SUM(daily_return) OVER (ORDER BY daily_return DESC ROWS UNBOUNDED PRECEDING) AS cum_contribution
FROM ohlc_daily
WHERE symbol = ? AND date BETWEEN ? AND ?
ORDER BY daily_return DESC
LIMIT 20;
```

#### 3. Monte Carlo in DuckDB with UNNEST

Generate 10,000 shuffled return sequences without leaving DuckDB:

```sql
-- Store raw returns array, shuffle via Python random seed, bulk insert simulations
-- Use DuckDB's LIST functions to avoid row-by-row Python loops
```

#### 4. Score cache invalidation

Skip recomputation if a valid score row exists for the same `(symbol, period_start, period_end)`:

```python
row = con.execute("""
    SELECT luck_score, rcr_pct, fragility_score
    FROM randomness_scores
    WHERE symbol = ? AND period_start = ? AND period_end = ?
      AND computed_at > now() - INTERVAL 1 DAY
""", [symbol, start, end]).fetchone()

if row:
    return row   # serve from cache
```

#### 5. Stock Health Page — lazy load by tab

When rendering the Stock Health page in React:

- **Tab 1 (Luck/Skill):** fires `GET /api/randomness/luck?symbol=X` — DuckDB query only
- **Tab 2 (Concentration):** fires `GET /api/randomness/concentration?symbol=X` — DuckDB query only
- **Tab 3 (Fragility):** fires `GET /api/randomness/fragility?symbol=X` — includes Monte Carlo; runs async, streams progress
- Never block the page load on Monte Carlo (10,000 shuffles); show skeleton cards for Tab 3 while it computes

#### 6. Batch pre-warm for watchlist

When user opens MarketDNA, pre-compute and cache scores for all watchlist tickers in a background thread:

```python
# background_tasks.py
def prewarm_randomness_scores(watchlist: list[str], period_years: int = 3):
    for symbol in watchlist:
        if not score_cached(symbol):
            compute_and_cache(symbol)
```

---

## Integration with MarketDNA Modules

| MarketDNA Module         | Randomness Engine Input      | Combined Output                              |
| ------------------------ | ---------------------------- | -------------------------------------------- |
| Regime Classifier        | Regime Dependence metric     | "Stock only works in bull regimes"           |
| Markov Transition Model  | Edge Persistence Score       | Probability regime that drives edge persists |
| Options Strategy Builder | Fragility Score + Luck Score | Confidence-weighted strategy sizing          |
| Black Swan Detector      | Path Sensitivity P10         | Tail risk of concentration unwinding         |

---

## Data Requirements

| Data Point           | Source                 | Min History | Storage                    |
| -------------------- | ---------------------- | ----------- | -------------------------- |
| Daily OHLC / returns | Kite Connect / NSE API | 3 years     | DuckDB `ohlc_daily`        |
| Nifty 50 benchmark   | NSE API                | Same period | DuckDB `ohlc_daily`        |
| Computed scores      | Engine output          | Per run     | DuckDB `randomness_scores` |

---

## Important Caveats

- **Hindsight limitation:** All metrics are backward-looking. Low Luck Score does not guarantee future outperformance.
- **Short periods are unreliable:** Run this engine on < 3 years of data with caution; flag explicitly in UI.
- **Regime availability:** Regime-dependent metrics (Module 3.4) require the MarketDNA Regime Classifier to have already run on the same ticker.
