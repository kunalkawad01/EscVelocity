---
name: stock-dna-analyzer
description: >
  Generate a comprehensive Stock DNA Report using 20 institutional-quality behavioral metrics
  derived purely from price history. Use this skill when the user asks for a "Stock DNA",
  "conviction score", "SWAN score", "compounder analysis", "anti-fragility score", "pain-to-gain ratio",
  "time under water", "drawdown frequency", "return concentration", "trend efficiency", "alpha half-life",
  "luck vs skill score", "capital efficiency", "wealth smoothness", or any request to go beyond CAGR/Sharpe
  and assess *quality* of returns for an Indian or global stock. Also trigger when the user says things like
  "show me the true risk profile of this stock", "is this stock a compounder?", "what is the consistency of returns?",
  "classify this stock", or "build a behavioral scorecard". This skill produces a full scored report and classifies
  stocks into archetypes (Elite Compounder, Steady Grinder, Lucky Speculator, etc.).
---

# Stock DNA Analyzer

Produces a **Stock DNA Report** — a scored behavioral profile of any stock using 20 metrics derived
from OHLCV price history. Goes far beyond CAGR/Sharpe to reveal _how_ returns were generated.

---

## Workflow

### Step 1 — Data Acquisition via Kite Connect

Fetch daily OHLCV history (minimum 2 years, ideally 5+) from **Kite Connect**. Store raw data in **DuckDB** for fast columnar querying throughout the pipeline.

```python
import duckdb
import numpy as np
import pandas as pd
from kiteconnect import KiteConnect

# --- Kite fetch ---
kite = KiteConnect(api_key=KITE_API_KEY)
kite.set_access_token(KITE_ACCESS_TOKEN)

instrument_token = kite.ltp(f"NSE:{ticker}")[f"NSE:{ticker}"]["instrument_token"]

records = kite.historical_data(
    instrument_token,
    from_date="2019-01-01",
    to_date=datetime.date.today().isoformat(),
    interval="day",
)
df = pd.DataFrame(records)  # columns: date, open, high, low, close, volume

# --- Persist to DuckDB for fast downstream querying ---
con = duckdb.connect(":memory:")   # use a file path for persistence
con.execute("CREATE TABLE ohlcv AS SELECT * FROM df")

# --- Pull prices + returns as numpy arrays for VectorBT / metric engine ---
prices_df = con.execute("SELECT date, close FROM ohlcv ORDER BY date").df()
prices = prices_df.set_index("date")["close"]
close_arr = prices.to_numpy(dtype=np.float64)   # raw numpy for speed
```

**DuckDB query helpers** — use these throughout metric calculations instead of pandas filtering:

```python
# Example: monthly closes for Consistency Score
monthly = con.execute("""
    SELECT DATE_TRUNC('month', date) AS month, LAST(close ORDER BY date) AS close
    FROM ohlcv
    GROUP BY 1 ORDER BY 1
""").df()

# Example: crash window slice
def crash_window(start, end):
    return con.execute(
        "SELECT date, close FROM ohlcv WHERE date BETWEEN ? AND ? ORDER BY date",
        [start, end]
    ).df()
```

---

### Step 2 — Compute All 20 Metrics

Use **VectorBT** for portfolio-level and drawdown metrics (fully vectorized, no Python loops where avoidable), and raw **NumPy** for custom signal math. Store results in a `scores` dict.

```python
import vectorbt as vbt

# VectorBT portfolio object — single source of truth for drawdown/return stats
pf = vbt.Portfolio.from_holding(close=prices, init_cash=100_000)
```

---

#### Metric 1: Consistency Score

**What it measures**: How often the stock makes money on a monthly basis.

```python
# DuckDB computes monthly closes natively
monthly_df = con.execute("""
    SELECT LAST(close ORDER BY date) / FIRST(close ORDER BY date) - 1 AS monthly_ret
    FROM ohlcv
    GROUP BY DATE_TRUNC('month', date)
    ORDER BY 1
""").df()
monthly_arr = monthly_df["monthly_ret"].to_numpy()
consistency_score = np.mean(monthly_arr > 0)  # 0 to 1
```

Display as: `Positive Months: 78%`

---

#### Metric 2: Return Concentration

**What it measures**: Whether gains depend on a few lucky days.

```python
# Pure NumPy — fast on large arrays
returns_arr = np.diff(close_arr) / close_arr[:-1]
total_return = np.prod(1 + returns_arr) - 1
top5_idx = np.argpartition(returns_arr, -5)[-5:]
top5_return = np.prod(1 + returns_arr[top5_idx]) - 1
concentration_ratio = top5_return / total_return if total_return != 0 else 1
# High ratio (>0.6) = fragile; low ratio = robust
```

Flag as "⚠️ Fragile" if top 5 days > 50% of total return.

---

#### Metric 3: Recovery Time

**What it measures**: Average days to recover from a 10%+ drawdown.

```python
# VectorBT handles drawdown lifecycle natively — no loops
drawdowns = pf.drawdowns
deep_dds = drawdowns.filter_by_max_drawdown(0.10)  # only ≥10% drawdowns
avg_recovery = deep_dds.recovery_duration.mean()   # in trading days
```

---

#### Metric 4: Trend Efficiency Ratio

**What it measures**: How much movement is trend vs noise.

```python
# NumPy vectorized — no pandas overhead
net_change = abs(close_arr[-1] - close_arr[0])
total_movement = np.sum(np.abs(np.diff(close_arr)))
efficiency = net_change / total_movement if total_movement > 0 else 0
# Range: 0 (pure noise) to 1 (perfect trend)
```

---

#### Metric 5: Drawdown Frequency

**What it measures**: How often 10

%+ drawdowns occur.

```python
# VectorBT — zero loops
dd_count = len(pf.drawdowns.filter_by_max_drawdown(0.10))
```

---

#### Metric 6: Pain-to-Gain Ratio

**What it measures**: Investor pain per 1% of return.

```python
# NumPy vectorized drawdown series
running_max = np.maximum.accumulate(close_arr)
dd_series = (close_arr - running_max) / running_max
total_pain = np.sum(np.abs(dd_series))
total_gain = (close_arr[-1] / close_arr[0] - 1) * 100
pain_to_gain = total_pain / total_gain if total_gain > 0 else np.inf
# Lower is better
```

---

#### Metric 7: Wealth Creation Smoothness

**What it measures**: How smooth the equity curve is.

```python
# NumPy log-linear regression — faster than scipy for large arrays
log_prices = np.log(close_arr)
x = np.arange(len(log_prices), dtype=np.float64)
x_mean, y_mean = x.mean(), log_prices.mean()
ss_xx = np.dot(x - x_mean, x - x_mean)
ss_xy = np.dot(x - x_mean, log_prices - y_mean)
ss_yy = np.dot(log_prices - y_mean, log_prices - y_mean)
smoothness_r2 = (ss_xy ** 2) / (ss_xx * ss_yy)
# R² close to 1 = perfect compounder; close to 0 = chaotic
```

---

#### Metric 8: Time Under Water

**What it measures**: % of time stock spent below its previous all-time high.

```python
running_max = np.maximum.accumulate(close_arr)
under_water = np.mean(close_arr < running_max)
# 10% = excellent; 70% = painful to hold
```

---

#### Metric 9: Momentum Persistence

**What it measures**: Probability of next-day gain after N consecutive up days.

```python
# NumPy rolling streak — fully vectorized via stride tricks
def momentum_persistence(arr, streak=3):
    up = (np.diff(arr) > 0).astype(np.int8)
    # Convolve to find streak of `streak` consecutive 1s
    kernel = np.ones(streak, dtype=np.int8)
    rolling_sum = np.convolve(up, kernel, mode='valid')
    streak_mask = rolling_sum == streak
    # Shift to get next-day outcome
    next_day = up[streak:]
    valid = next_day[:len(streak_mask)]
    return np.mean(valid[streak_mask[:len(valid)]])

mp3 = momentum_persistence(close_arr, streak=3)
mp5 = momentum_persistence(close_arr, streak=5)
mp7 = momentum_persistence(close_arr, streak=7)
```

---

#### Metric 10: Crash Resistance Score

**What it measures**: Max drawdown during known crash periods relative to Nifty 50.

```python
crash_windows = {
    'COVID (Mar 2020)': ('2020-02-17', '2020-03-23'),
    '2022 Correction': ('2022-01-01', '2022-06-17'),
    '2024 FII Selloff': ('2024-09-27', '2024-11-01'),
}

# DuckDB makes windowed queries trivial
def crash_return(con, start, end):
    row = con.execute("""
        SELECT LAST(close ORDER BY date) / FIRST(close ORDER BY date) - 1 AS ret
        FROM ohlcv WHERE date BETWEEN ? AND ?
    """, [start, end]).fetchone()
    return row[0] if row else None

crash_scores = {name: crash_return(con, s, e)
                for name, (s, e) in crash_windows.items()}
# Compare each to Nifty 50 fetched via same Kite pipeline
```

---

#### Metric 11: Conviction Score

**What it measures**: Composite of consistency, recovery, trend efficiency, and drawdown behavior.

```python
# Normalize each to 0–100
def normalize(val, low, high, invert=False):
    score = max(0, min(100, (val - low) / (high - low) * 100))
    return 100 - score if invert else score

conviction = (
    normalize(consistency_score, 0.4, 1.0) * 0.30 +
    normalize(smoothness_r2, 0, 1) * 0.25 +
    normalize(efficiency, 0, 1) * 0.20 +
    normalize(under_water, 0, 1, invert=True) * 0.15 +
    normalize(pain_to_gain, 0, 5, invert=True) * 0.10
)
```

---

#### Metric 12: Anti-Fragility Score

**What it measures**: Does volatility help or hurt future returns?

```python
# NumPy rolling via stride tricks — avoids pandas overhead
window = 63  # ~3 months
returns_arr = np.diff(close_arr) / close_arr[:-1]

def rolling_std(arr, w):
    shape = arr.shape[:-1] + (arr.shape[-1] - w + 1, w)
    strides = arr.strides + (arr.strides[-1],)
    windows = np.lib.stride_tricks.as_strided(arr, shape=shape, strides=strides)
    return windows.std(axis=-1)

vol = rolling_std(returns_arr, window) * np.sqrt(252)
fwd_ret = close_arr[window*2:] / close_arr[window:-window] - 1
min_len = min(len(vol), len(fwd_ret))
anti_fragility = np.corrcoef(vol[:min_len], fwd_ret[:min_len])[0, 1]
# Positive = anti-fragile; Negative = fragile
```

---

#### Metric 13: SWAN Score (Sleep Well At Night)

**What it measures**: Custom composite for investor comfort.

```python
swan = (
    normalize(consistency_score, 0.4, 1.0) * 0.25 +
    normalize(under_water, 0, 0.7, invert=True) * 0.25 +
    normalize(avg_recovery, 0, 200, invert=True) * 0.20 +
    normalize(efficiency, 0, 1) * 0.15 +
    normalize(daily_vol_annualized, 0, 0.6, invert=True) * 0.15
)
```

---

#### Metric 14: Compounding Quality Score

**What it measures**: True quality of compounding (CAGR × smoothness × recovery factor).

```python
years = len(prices) / 252
cagr = (prices.iloc[-1] / prices.iloc[0]) ** (1/years) - 1

recovery_factor = 1 / (1 + avg_recovery/252) if avg_recovery else 1
compounding_quality = (
    normalize(cagr, 0, 0.3) * 0.35 +
    normalize(smoothness_r2, 0, 1) * 0.35 +
    normalize(recovery_factor, 0, 1) * 0.15 +
    normalize(dd_count, 0, 10, invert=True) * 0.15
)
```

---

#### Metric 15: Opportunity Cost Score

**What it measures**: How much capital was trapped in sideways periods.

```python
# DuckDB: label each day as sideways if price within ±5% of 52-week start
sideways_fraction = con.execute("""
    WITH base AS (
        SELECT date, close,
               FIRST_VALUE(close) OVER (
                   ORDER BY date
                   ROWS BETWEEN 251 PRECEDING AND CURRENT ROW
               ) AS year_start_close
        FROM ohlcv
    )
    SELECT AVG(CASE WHEN ABS(close / year_start_close - 1) < 0.05 THEN 1.0 ELSE 0.0 END)
    FROM base
""").fetchone()[0]
# High = capital was trapped; Low = stock always moving
```

---

#### Metric 16: Market Regime Performance

**What it measures**: Returns split by bull/bear/sideways market regimes.

```python
# Store Nifty 50 in same DuckDB instance
# con.execute("CREATE TABLE nifty AS SELECT * FROM nifty_df")

regime_perf = con.execute("""
    WITH nifty_ma AS (
        SELECT date,
               close AS nifty_close,
               AVG(close) OVER (ORDER BY date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) AS ma200
        FROM nifty
    ),
    regimes AS (
        SELECT date,
               CASE
                   WHEN nifty_close > ma200 * 1.10 THEN 'Bull'
                   WHEN nifty_close < ma200 * 0.90 THEN 'Bear'
                   ELSE 'Sideways'
               END AS regime
        FROM nifty_ma
    )
    SELECT r.regime,
           EXP(SUM(LN(1 + (o.close / LAG(o.close) OVER (ORDER BY o.date)) - 1))) - 1 AS period_return
    FROM ohlcv o
    JOIN regimes r USING (date)
    GROUP BY r.regime
""").df()
```

---

#### Metric 17: Luck vs Skill Score

**What it measures**: Performance stability after removing best days.

```python
# NumPy — argsort is O(n log n), much faster than pandas sort_values
def luck_vs_skill(returns_arr):
    total = np.prod(1 + returns_arr) - 1
    sorted_idx = np.argsort(returns_arr)   # ascending
    ex1  = np.prod(1 + returns_arr[sorted_idx[:-1]])  - 1
    ex5  = np.prod(1 + returns_arr[sorted_idx[:-5]])  - 1
    ex10 = np.prod(1 + returns_arr[sorted_idx[:-10]]) - 1
    skill_ratio = ex10 / total if total != 0 else 0
    return {'remove_1': ex1, 'remove_5': ex5,
            'remove_10': ex10, 'skill_ratio': skill_ratio}
```

---

#### Metric 18: Capital Efficiency Score

**What it measures**: Return per unit of maximum drawdown (Calmar-style).

```python
# VectorBT has max_drawdown built-in
max_dd = pf.max_drawdown   # already a fraction, e.g. -0.28
years = len(close_arr) / 252
cagr = (close_arr[-1] / close_arr[0]) ** (1 / years) - 1
capital_efficiency = cagr / abs(max_dd) if max_dd != 0 else np.inf
# Better than Sharpe for retail investors; intuitive
```

---

#### Metric 19: Alpha Half-Life

**What it measures**: How long momentum survives after a strong up month.

```python
# DuckDB produces monthly returns; numpy does the lag correlation
monthly_arr = con.execute("""
    SELECT LAST(close ORDER BY date) / FIRST(close ORDER BY date) - 1 AS m_ret
    FROM ohlcv
    GROUP BY DATE_TRUNC('month', date)
    ORDER BY 1
""").df()["m_ret"].to_numpy()

def alpha_half_life(m_arr, lags=(1, 3, 6, 12)):
    threshold = np.percentile(m_arr, 75)
    strong_up = m_arr > threshold
    results = {}
    for lag in lags:
        fwd = np.roll(m_arr, -lag)
        mask = strong_up[:len(fwd)-lag]
        results[f'{lag}m'] = np.mean(fwd[:len(mask)][mask])
    return results
```

---

#### Metric 20: Stock DNA Classification

After computing all metrics, classify into archetype:

```python
def classify_stock(conviction, swan, compounding_quality, luck_ratio, anti_fragility):
    if conviction >= 80 and compounding_quality >= 75:
        return "🏆 Elite Compounder"
    elif conviction >= 70 and swan >= 70:
        return "💎 Steady Grinder"
    elif luck_ratio < 0.4:
        return "🎰 Lucky Speculator"
    elif anti_fragility > 0.2:
        return "🦾 Anti-Fragile Growth"
    elif conviction >= 60 and compounding_quality < 50:
        return "📊 Volatile Performer"
    elif under_water > 0.6:
        return "😴 Capital Trap"
    else:
        return "🔄 Mean Reverter"
```

**Archetype Descriptions**:
| Archetype | Meaning |
|---|---|
| Elite Compounder | High consistency, smooth growth, fast recovery. Think Asian Paints / Titan |
| Steady Grinder | Reliable but not spectacular. Good for SIP investors |
| Lucky Speculator | Returns driven by a few big days. Fragile |
| Anti-Fragile Growth | Emerges stronger after corrections |
| Volatile Performer | Good returns but painful journey |
| Capital Trap | Long sideways periods; opportunity cost is high |
| Mean Reverter | Oscillates; better for trading than holding |

---

### Step 3 — Generate the Report

Output the full Stock DNA Report in this format:

```
═══════════════════════════════════════════════
        STOCK DNA REPORT: [TICKER]
        Period: [start] → [end] | [N] years
═══════════════════════════════════════════════

ARCHETYPE: 🏆 Elite Compounder

CORE RETURNS
  CAGR                    : 24.3%
  Positive Months         : 82%           ← Consistency Score
  Return Concentration    : 18%           ← % of return from top 5 days (low = good)
  Capital Efficiency      : 2.8x          ← CAGR / Max Drawdown

RESILIENCE
  Max Drawdown            : -28%
  Drawdown Frequency      : 2             ← >10% drawdowns in period
  Avg Recovery Time       : 38 days
  Time Under Water        : 22%

QUALITY OF TREND
  Trend Efficiency        : 0.74          ← Net move / Total movement
  Wealth Smoothness (R²)  : 0.91
  CAGR after removing top 10 days: 14.2%
  Skill Ratio             : 0.58          ← High = skill-driven

BEHAVIORAL METRICS
  Pain-to-Gain Ratio      : 0.82          ← Lower is better
  Anti-Fragility Score    : +0.18         ← Positive = benefits from vol
  Opportunity Cost        : 12%           ← % time spent sideways
  Momentum Persistence    : 58%           ← After 3 up days, probability of 4th

COMPOSITE SCORES
  Conviction Score        : 87 / 100
  SWAN Score              : 82 / 100
  Compounding Quality     : 88 / 100

REGIME PERFORMANCE
  Bull Markets  : +31.2%
  Bear Markets  : -8.4%
  Sideways      : +9.7%

ALPHA HALF-LIFE
  1 month  : +1.2%
  3 months : +0.8%
  6 months : +0.3%
  12 months: -0.1%          ← Alpha fades within a year

═══════════════════════════════════════════════
VERDICT: Strong compounder with institutional-quality
         resilience. Suitable for multi-year holding.
═══════════════════════════════════════════════
```

---

### Step 4 — Visualization with Highcharts

Render all charts using **Highcharts** (already available in StockIQ/QuantFlow). Pass computed scores from the Python backend as JSON to the frontend.

#### Chart 1: DNA Radar (Spider Chart)

```javascript
Highcharts.chart("dna-radar", {
  chart: { polar: true, type: "line", backgroundColor: "transparent" },
  title: { text: `Stock DNA — ${ticker}`, style: { color: "#e0c97f" } },
  xAxis: {
    categories: [
      "Conviction",
      "SWAN",
      "Compounding",
      "Capital Eff.",
      "Anti-Fragility",
      "Consistency",
    ],
    tickmarkPlacement: "on",
    lineWidth: 0,
  },
  yAxis: { gridLineInterpolation: "polygon", min: 0, max: 100 },
  series: [
    {
      name: ticker,
      data: [
        conviction,
        swan,
        compounding_quality,
        capital_eff_norm,
        anti_fragility_norm,
        consistency_norm,
      ],
      color: "#e0c97f",
      pointPlacement: "on",
    },
  ],
});
```

#### Chart 2: Drawdown Timeline

```javascript
Highcharts.chart("drawdown-chart", {
  chart: { type: "area", backgroundColor: "transparent" },
  title: { text: "Drawdown History" },
  xAxis: { type: "datetime" },
  yAxis: { title: { text: "Drawdown %" }, max: 0 },
  series: [
    {
      name: "Drawdown",
      data: drawdownSeries, // [[timestamp, pct], ...]
      color: "#e05c5c",
      fillOpacity: 0.3,
    },
  ],
});
```

#### Chart 3: Regime Performance Bar

```javascript
Highcharts.chart("regime-chart", {
  chart: { type: "column", backgroundColor: "transparent" },
  xAxis: { categories: ["Bull", "Bear", "Sideways"] },
  yAxis: { title: { text: "Return %" }, labels: { format: "{value}%" } },
  series: [
    {
      name: ticker,
      data: [bullReturn, bearReturn, sidewaysReturn],
      color: "#e0c97f",
    },
  ],
});
```

#### Chart 4: Equity Curve with Trendline (Highcharts Stock)

```javascript
Highcharts.stockChart("equity-curve", {
  series: [
    { name: ticker, data: ohlcvData, type: "candlestick" },
    {
      name: "Log Trend",
      data: trendlineData,
      type: "line",
      color: "#e0c97f",
      dashStyle: "Dash",
      lineWidth: 1,
    },
  ],
});
```

---

## Notes on Indian Markets

- Use **Nifty 50** (`^NSEI`) as the reference index for crash resistance and regime classification
- Standard NSE crash periods to include: COVID (Feb–Mar 2020), SEBI derivative margin crisis (2021), 2022 global correction, Oct 2024 FII selloff
- For F&O stocks, momentum persistence is especially relevant (high liquidity = cleaner signals)
- Elite Indian compounders for calibration reference: Asian Paints, Titan, Nestlé India, PI Industries, HDFC Bank (pre-merger), Bajaj Finance

## Dependencies

```python
# Core computation stack
import numpy as np          # pip install numpy
import duckdb               # pip install duckdb
import vectorbt as vbt      # pip install vectorbt
import pandas as pd         # pip install pandas  (for Kite response parsing)

# Data provider
from kiteconnect import KiteConnect   # pip install kiteconnect
# Requires: KITE_API_KEY, KITE_ACCESS_TOKEN (from your existing StockIQ config)

# Optional
from scipy import stats     # only needed if replacing NumPy R² with scipy linregress
```

**Visualization**: Highcharts (loaded via CDN in StockIQ/QuantFlow frontend):

```html
<script src="https://code.highcharts.com/highcharts.js"></script>
<script src="https://code.highcharts.com/highcharts-more.js"></script>
<!-- for radar -->
<script src="https://code.highcharts.com/stock/highstock.js"></script>
<!-- for equity curve -->
```

**No yfinance. No matplotlib. No Recharts.**
