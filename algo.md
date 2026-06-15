# Historical Analog Engine — Algorithm

## What it does

Given a stock's current market environment, find the most similar historical periods
and show what the stock did in the months that followed.

---

## Step-by-step

### Step 1 — Build the feature table (DuckDB)

For every trading day that has:
- At least **200 bars of history** (needed to compute SMA200)
- At least **126 bars of future data** (needed for 6-month forward returns)

Compute 5 features:

| Feature | How it is calculated |
|---|---|
| `regime_score` | Count of SMAs (20, 50, 100, 200) that close is above. Range: 0–4 |
| `ret_1m` | `(close - close_20d_ago) / close_20d_ago × 100` |
| `ret_3m` | `(close - close_63d_ago) / close_63d_ago × 100` |
| `drawdown` | `(close - rolling_peak) / rolling_peak × 100` (always ≤ 0) |
| `atr14` | Average True Range over the last 14 bars |

Also compute 3 **forward return** columns (used for output only, not for matching):

| Column | Meaning |
|---|---|
| `fwd_1m` | Return over the next 21 trading days |
| `fwd_3m` | Return over the next 63 trading days |
| `fwd_6m` | Return over the next 126 trading days |

All of this runs in a single DuckDB query using window functions.

---

### Step 2 — Normalise features to [0, 1]

Each feature is scaled globally using min-max normalisation:

```
normalised = (value - min) / (max - min)
```

This ensures no feature dominates because of its raw magnitude
(e.g. ATR in rupees vs drawdown in %).

If `max == min` (a constant column), the normalised value is 0 for all rows.

---

### Step 3 — Extract today's feature vector

The last row in the table is today. Its 5 normalised values form the **query vector**:

```
today = [regime_n, ret_1m_n, ret_3m_n, drawdown_n, atr_n]
```

---

### Step 4 — Compute weighted Manhattan distance

For every historical candidate row, compute:

```
distance = w1 × |regime_n_hist   - regime_n_today|
         + w2 × |ret_1m_n_hist   - ret_1m_n_today|
         + w3 × |ret_3m_n_hist   - ret_3m_n_today|
         + w4 × |drawdown_n_hist - drawdown_n_today|
         + w5 × |atr_n_hist      - atr_n_today|
```

Weights:

| Feature | Weight | Why |
|---|---|---|
| Regime score | 0.25 | Market structure is the primary context |
| 1M return | 0.25 | Recent momentum is the strongest similarity signal |
| Drawdown | 0.20 | Depth of pain defines the risk environment |
| 3M return | 0.15 | Intermediate trend gives broader context |
| ATR(14) | 0.15 | Volatility environment shapes outcomes |

Weights sum to 1.0. Maximum possible distance is 1.0 (all features at opposite extremes).

Manhattan distance is used instead of Euclidean because:
- It is easier to reason about (each feature contributes independently)
- It is less sensitive to single-feature outliers than squared distances

---

### Step 5 — Convert distance to similarity score

```
similarity = (1 - distance) × 100
```

Range: 0–100. Higher means more similar.

---

### Step 6 — Select the top 5 with no overlap

Sort all candidates by distance ascending (closest first).

Walk through the sorted list and pick a candidate only if it is at least
**21 trading days away** from the last selected date.

This prevents the engine from selecting a cluster of nearly identical
adjacent days as separate analogs.

---

### Step 7 — Build the output

For each selected analog:
- Date, similarity score, regime label, drawdown, 1M return (context)
- Forward 1M, 3M, 6M returns (outcome)

Aggregate stats over all analogs:
- Average forward 1M, 3M, 6M return
- % of analogs where 1M return was positive
- % of analogs where 3M return was positive

---

## Why these 5 features

The goal is to match environments, not price levels. Five features capture the
four dimensions that define a stock's market environment:

1. **Trend structure** (regime score) — is price in a healthy or broken trend?
2. **Recent momentum** (ret_1m, ret_3m) — how has the stock been behaving?
3. **Stress depth** (drawdown) — how far is the stock from its peak?
4. **Volatility** (ATR) — is the market calm or turbulent?

---

## Limitations

- Normalisation is **global** (uses all data at once), not point-in-time.
  A proper walk-forward implementation would normalise only using data available
  up to each candidate date. This is a known approximation.
- With ~5 years of data per stock (~1250 bars), the candidate pool after
  filtering is roughly 1000–1100 dates. This is sufficient for meaningful results
  but not large enough to surface very rare regimes reliably.
- Forward returns reflect what actually happened, not what was predictable.
  Analogs are a research lens, not a prediction.
