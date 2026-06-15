# Regime Score & Market Breadth Score

**Module:** `app/services/regime_service.py`  
**Router:** `app/routers/regime.py` — prefix `/api/regime`  
**Models:** `app/models/regime.py`

---

## Purpose

Two companion scores that answer the questions every quantitative analyst asks before acting on any signal:

1. **Is this individual stock in a healthy, trending structure?** → *Regime Score*
2. **Is the broader market participating, or is this a narrow/fragile move?** → *Market Breadth Score*

These scores are upstream of all other analysis. The Indicator Edge Lab tells you *which signals work for a given stock historically*. The Regime Score tells you *whether the current structural environment is similar to the conditions in which those signals worked*.

---

## Regime Score

### What it measures

The Regime Score captures the **structural trend quality** of a single stock on a 0–100 scale. It is not a momentum indicator. It does not ask "is the stock going up today?" It asks "is the stock in a well-ordered, trend-consistent structure?"

A score of 100 means:
- Price is above all four SMAs (20, 50, 100, 200)
- All SMAs are in the correct bull order (20 > 50 > 100 > 200)
- All SMAs are rising (the trend has momentum in time)

A score of 0 means the opposite is true for every component.

### Formula

The score is composed of three independent components that sum to a maximum of 100.

#### Component 1 — Price Position (0–40 points)

Asks: where is price relative to each moving average?

| Condition         | Points |
|-------------------|--------|
| price > SMA 200   | +10    |
| price > SMA 100   | +10    |
| price > SMA 50    | +10    |
| price > SMA 20    | +10    |

**Rationale:** The SMA 200 is the most widely watched structural level. Being above it alone means the stock is in a long-term uptrend. Each progressively shorter SMA adds evidence that the trend is intact across time frames.

#### Component 2 — SMA Alignment (0–30 points)

Asks: are the moving averages in "bull stack" order?

| Condition            | Points |
|----------------------|--------|
| SMA 20 > SMA 50      | +10    |
| SMA 50 > SMA 100     | +10    |
| SMA 100 > SMA 200    | +10    |

**Rationale:** A "bull stack" (shorter MA above longer MA at every level) is the canonical structure of a healthy uptrend. It means price has been, on average, higher in the recent past than the distant past — the definition of an uptrend. This component separates stocks that are merely above SMA 200 (possibly recovering) from stocks that are in a fully ordered bull structure.

#### Component 3 — SMA Slope (0–30 points)

Asks: are the SMAs themselves rising?

| Condition                                  | Lookback | Points |
|--------------------------------------------|----------|--------|
| SMA 20 today > SMA 20 five bars ago        | 5 bars   | +10    |
| SMA 50 today > SMA 50 ten bars ago         | 10 bars  | +10    |
| SMA 200 today > SMA 200 twenty bars ago    | 20 bars  | +10    |

**Rationale:** A stock can be above all SMAs while those SMAs are declining — a dangerous situation where a bounce is occurring within a structural downtrend. Slope confirms the *direction of the structural foundation*. Longer SMAs use longer lookback windows because their relevant rate of change is slower.

### Score labels

| Range  | Label          | Interpretation                                              |
|--------|----------------|-------------------------------------------------------------|
| 80–100 | Strong Bull    | All conditions met; textbook uptrend                        |
| 60–79  | Moderate Bull  | Most conditions met; above majority of SMAs, mostly aligned |
| 40–59  | Neutral        | Mixed signals; transition zone between regimes              |
| 20–39  | Moderate Bear  | Below most SMAs; trend deteriorating                        |
| 0–19   | Strong Bear    | Full bear structure; avoid long signals                     |

### What Regime Score is NOT

- It is **not** a buy/sell signal. A 100 score does not mean "buy now."
- It is **not** overbought/oversold. High scores can persist for months in strong trends.
- It is **not** a prediction of future returns.

It is a **filter**. Use it to decide which bucket of historical Edge Lab data is relevant. The win rate for RSI oversold on RELIANCE might be 65% overall — but you should check whether that 65% was achieved in Regime Score > 60 conditions or in any regime.

---

## Market Breadth Score

### What it measures

The Market Breadth Score measures **how broadly the NIFTY 50 is participating** in the current market move. A strong index return driven by 5 stocks out of 50 is very different from a return driven by 45 stocks — the former is fragile, the latter is healthy.

### Formula

For each of the 50 NIFTY stocks, the service checks whether today's close is above its SMA 20, SMA 50, and SMA 200. The three participation percentages are combined as a weighted average:

```
breadth_score = pct_above_sma20  × 0.30
              + pct_above_sma50  × 0.40
              + pct_above_sma200 × 0.30
```

**Weight rationale:**

| SMA  | Weight | Rationale                                                                     |
|------|--------|-------------------------------------------------------------------------------|
| 20   | 0.30   | Short-term participation; noisier, lower weight                               |
| 50   | 0.40   | Medium-term participation; the canonical "trend confirmation" SMA              |
| 200  | 0.30   | Long-term structural participation; important but slow-moving, lower weight   |

Since each percentage is already 0–100, the weighted sum is also 0–100.

### Score labels

| Range  | Label                 | Interpretation                                              |
|--------|-----------------------|-------------------------------------------------------------|
| ≥ 70   | Broad Participation   | Most stocks above key SMAs; healthy market                  |
| 50–69  | Moderate Breadth      | Above-average participation; cautiously healthy             |
| 30–49  | Narrow Breadth        | Below-average participation; breadth deteriorating          |
| < 30   | Poor Breadth          | Few stocks above key SMAs; distribution or bear market      |

### Breadth divergence (key insight)

**Breadth divergence** is when the index makes a new high but breadth is falling. This is one of the most reliable early warnings in market analysis. Example interpretation:

> NIFTY 50 is at a 52-week high but Breadth Score is 38 (Narrow Breadth).
> Only 19/47 stocks are above SMA 50. This rally is being driven by a handful
> of large-cap stocks. Historically, such breadth divergences precede corrections.

---

## API Reference

### `GET /api/regime/{symbol}`

Returns the full Regime Score breakdown for a single stock.

**Response: `RegimeScoreResult`**

```json
{
  "symbol": "RELIANCE",
  "date": "2026-06-05",
  "close": 1291.0,
  "regime_score": 0.0,
  "regime_label": "Strong Bear",
  "components": {
    "price_score": 0.0,
    "alignment_score": 0.0,
    "slope_score": 0.0
  },
  "sma": {
    "sma20": 1345.21, "sma50": 1362.59, "sma100": 1390.45, "sma200": 1426.44,
    "above_sma20": false, "above_sma50": false, "above_sma100": false, "above_sma200": false
  },
  "slope": {
    "sma20_slope": -2.497, "sma50_slope": -1.009, "sma200_slope": -0.495,
    "sma20_rising": false, "sma50_rising": false, "sma200_rising": false
  },
  "sma_fully_aligned": false,
  "history": [
    { "date": "2025-06-05", "close": 1442.4, "regime_score": 70.0 },
    ...
  ],
  "computed_at": "2026-06-10 05:30 UTC"
}
```

**Fields:**

| Field               | Type    | Description                                      |
|---------------------|---------|--------------------------------------------------|
| `regime_score`      | float   | Composite 0–100                                  |
| `regime_label`      | string  | One of five text labels                          |
| `components`        | object  | price_score (0–40), alignment_score (0–30), slope_score (0–30) |
| `sma`               | object  | SMA levels and above/below flags                 |
| `slope`             | object  | % change of each SMA over its lookback window    |
| `sma_fully_aligned` | bool    | True when SMA20 > SMA50 > SMA100 > SMA200        |
| `history`           | array   | Last 252 trading days of regime scores           |

---

### `GET /api/regime/breadth`

Returns today's Breadth Score and 252 days of history.

**Response: `BreadthScoreResult`**

```json
{
  "date": "2026-06-05",
  "pct_above_sma20": 27.7,
  "pct_above_sma50": 40.4,
  "pct_above_sma200": 46.8,
  "count_above_sma20": 13,
  "count_above_sma50": 19,
  "count_above_sma200": 22,
  "total_symbols": 47,
  "breadth_score": 38.5,
  "breadth_label": "Narrow Breadth",
  "history": [
    { "date": "2025-06-05", "breadth_score": 71.2, "pct_above_sma20": 74.5, ... },
    ...
  ],
  "computed_at": "2026-06-10 05:30 UTC"
}
```

---

### `GET /api/regime/snapshot`

Returns regime scores for all NIFTY 50 stocks plus breadth in a single call. Used by the frontend dashboard.

**Response: `MarketRegimeSnapshot`**

```json
{
  "date": "2026-06-05",
  "breadth": { ...BreadthScoreResult },
  "stocks": [
    {
      "symbol": "ADANIPORTS",
      "regime_score": 100.0,
      "regime_label": "Strong Bull",
      "close": 1352.0,
      "above_sma200": true,
      "sma_fully_aligned": true,
      "price_score": 40.0,
      "alignment_score": 30.0,
      "slope_score": 30.0
    },
    ...
  ],
  "avg_regime_score": 44.3,
  "strong_bull_count": 12,
  "bull_count": 6,
  "neutral_count": 7,
  "bear_count": 9,
  "strong_bear_count": 13,
  "computed_at": "2026-06-10 05:30 UTC"
}
```

---

### `POST /api/regime/invalidate`

Clears all caches (call after new data ingestion).

---

## Caching

All three endpoints are cached by calendar date at module level. The first request of the day triggers computation; subsequent requests return instantly.

| Cache key        | Scope                     |
|------------------|---------------------------|
| `(symbol, date)` | Per-stock regime score    |
| `date`           | Market breadth            |
| `date`           | Market snapshot           |

To force a recalculation without restarting the server, call `POST /api/regime/invalidate`.

---

## Integration with Indicator Edge Lab

The correct workflow for using Edge Lab + Regime together:

1. Check the **Market Breadth Score**. If breadth is < 30 (Poor), be skeptical of all bullish edge lab signals.
2. Check the stock's **Regime Score** before acting on its best indicator.
   - Edge Lab says "RSI < 30 has 65% win rate for RELIANCE" → check if current Regime Score is in the range where that 65% was achieved.
   - A bullish oversold signal in a Regime Score of 10 (Strong Bear) is likely a falling knife.
3. Use the **slope info** to detect regime transitions. When SMA 200 slope flips positive after a bear trend, that is an early regime recovery signal.

---

## Example interpretations

### Example 1 — Strong setup
```
COALINDIA: Regime Score = 100, Breadth Score = 65
→ Price above all SMAs, full bull stack, all SMAs rising.
→ Breadth at 65 (Moderate) — most stocks healthy.
→ Bullish Edge Lab signals on COALINDIA have full structural support.
```

### Example 2 — Bearish trap
```
RELIANCE: Regime Score = 0, Breadth Score = 38
→ Price below all SMAs, inverted alignment, all SMAs declining.
→ Breadth at 38 (Narrow) — broad market is also weak.
→ Any bullish Edge Lab signal on RELIANCE should be treated with high skepticism.
→ Bearish Edge Lab signals have structural support.
```

### Example 3 — Transition zone
```
HDFCBANK: Regime Score = 50, Breadth Score = 55
→ Mixed signals — above some SMAs, below others.
→ Breadth moderate. Market neither in full bull nor full bear.
→ Wait for regime to resolve before committing to directional trades.
```

---

## Data requirements

- Minimum 200 bars of daily OHLCV per symbol (required for SMA 200)
- Data sourced from `data_lake/raw/equities/**/*.parquet` via hive partitioning
- Symbols with < 200 bars are silently skipped in the snapshot

---

## Performance

The snapshot endpoint computes regime scores for all 50 stocks. Each stock requires one DuckDB query + NumPy array operations. On a cold cache, expect 10–20 seconds. On a warm cache (same calendar day), the response is instant.

The breadth score uses a single DuckDB query with window functions across all symbols and 252 days — typically < 3 seconds cold.
